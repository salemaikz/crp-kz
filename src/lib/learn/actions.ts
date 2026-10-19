'use server';
// Server actions обучения — тонкие обёртки: сессия, zod-проверка ввода, вызов логики, понятный результат.
// Ожидаемые отказы возвращаются как { ok: false, error }, а не бросаются.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser, type User } from '../auth';
import { rateLimit } from '../auth/rateLimit';
import { redirect } from '../i18n/navigation';
import { issueCertificate, normalizeCertificateNumber } from './certificates';
import { LearnError } from './errors';
import { completeLesson } from './progress';
import { submitQuiz } from './quiz';
import { certFormAllowed } from './server';
import type { ActionResult, CompleteData, QuizResult } from './types';

const id = z.string().min(1).max(64);
const locale = z.enum(['ru', 'kz']);

const quizInput = z.object({
  lessonId: id,
  blockId: id,
  // по массиву индексов на вопрос; границы по options проверяет validateAnswers
  answers: z.array(z.array(z.number().int().min(0).max(63)).max(64)).min(1).max(100),
  locale,
});
const completeInput = z.object({ lessonId: id, locale });
const certificateInput = z.object({ courseId: id, locale });

/** Не более 60 попыток тестов за 10 минут на пользователя. */
const QUIZ_LIMIT = { limit: 60, windowMs: 10 * 60_000 } as const;

async function run<T>(fn: (user: User) => Promise<T>): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  try {
    return { ok: true, data: await fn(user) };
  } catch (e) {
    if (e instanceof LearnError) return { ok: false, error: e.code };
    console.error('[learn] action failed', e);
    return { ok: false, error: 'server' };
  }
}

/** Сдать тест: { lessonId, blockId, answers: number[][], locale } → счёт; разбор и пояснения — только при сдаче (D-020). */
export async function submitQuizAction(input: unknown): Promise<ActionResult<QuizResult>> {
  const parsed = quizInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  return run(async (user) => {
    if (!rateLimit(`quiz:${user.id}`, QUIZ_LIMIT.limit, QUIZ_LIMIT.windowMs).ok) throw new LearnError('rate_limited');
    return submitQuiz({ userId: user.id, ...parsed.data });
  });
}

/** Отметить урок пройденным. */
export async function markCompleteAction(input: unknown): Promise<ActionResult<CompleteData>> {
  const parsed = completeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const res = await run((user) => completeLesson({ userId: user.id, ...parsed.data }));
  if (res.ok) revalidatePath(`/${parsed.data.locale}/learn`, 'layout');
  return res;
}

/** Получить сертификат (идемпотентно). */
export async function issueCertificateAction(
  input: unknown,
): Promise<ActionResult<{ number: string; created: boolean }>> {
  const parsed = certificateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const res = await run(async (user) => {
    const { certificate, created } = await issueCertificate({
      user: { id: user.id, name: user.name },
      courseId: parsed.data.courseId,
      locale: parsed.data.locale,
    });
    return { number: certificate.number, created };
  });
  if (res.ok) revalidatePath(`/${parsed.data.locale}/learn`, 'layout');
  return res;
}

/** Форма «Проверить сертификат»: нормализует номер и ведёт на публичную страницу проверки. */
export async function lookupCertificateAction(formData: FormData): Promise<void> {
  const loc = locale.catch('ru').parse(formData.get('locale'));
  const raw = formData.get('number');
  const text = typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, 40) : '';
  if (!text) redirect({ href: '/cert', locale: loc });
  if (!(await certFormAllowed())) {
    redirect({ href: '/cert', locale: loc });
  }
  redirect({ href: `/cert/${encodeURIComponent(normalizeCertificateNumber(text) ?? text)}`, locale: loc });
}
