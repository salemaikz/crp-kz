'use server';
// Server action «Назначить курс». Логика и проверки прав — в ./assign; здесь только разбор формы.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '../auth';
import { assignCourse, MAX_ASSIGN } from './assign';
import { parseDueDate } from './dates';
import { TeamError, type TeamErrorCode } from './types';

export type AssignState =
  | { status: 'success'; assigned: number; skipped: number; nonce: number }
  | { status: 'error'; code: TeamErrorCode; nonce: number }
  | undefined;

const inputSchema = z.object({
  locale: z.enum(['ru', 'kz']),
  orgId: z.string().min(1).max(64),
  courseId: z.string().min(1).max(64),
  userIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_ASSIGN),
  due: z.string().max(10).optional(),
});

function str(fd: FormData, name: string): string | undefined {
  const v = fd.get(name);
  return typeof v === 'string' ? v : undefined;
}

export async function assignCourseAction(_prev: AssignState, formData: FormData): Promise<AssignState> {
  const nonce = Date.now();
  const rawLocale = str(formData, 'locale') === 'kz' ? 'kz' : 'ru';
  // гость или истёкшая сессия → на вход, после входа вернётся в «Команду»
  const user = await requireUser(rawLocale, `/${rawLocale}/team`);

  const userIds = formData.getAll('userIds').filter((v): v is string => typeof v === 'string');
  if (userIds.length === 0) return { status: 'error', code: 'no_employees', nonce };
  const parsed = inputSchema.safeParse({
    locale: rawLocale,
    orgId: str(formData, 'orgId'),
    courseId: str(formData, 'courseId'),
    userIds,
    due: str(formData, 'due'),
  });
  if (!parsed.success) {
    return { status: 'error', code: userIds.length > MAX_ASSIGN ? 'too_many' : 'invalid_input', nonce };
  }
  const { orgId, courseId, due, locale } = parsed.data;

  try {
    const result = await assignCourse({
      actorId: user.id,
      orgId,
      courseId,
      userIds: parsed.data.userIds,
      dueAt: parseDueDate(due),
    });
    revalidatePath('/[locale]/team', 'page');
    return { status: 'success', assigned: result.assigned.length, skipped: result.skipped.length, nonce };
  } catch (e) {
    if (e instanceof TeamError) return { status: 'error', code: e.code, nonce };
    console.error(`[team] не удалось назначить курс (${locale})`, e);
    throw e;
  }
}
