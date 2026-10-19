'use server';
// Server action «Начать бесплатно». Вся логика — в ./start (проверки доступа и видимости на сервере).
import { z } from 'zod';
import { requireUser } from '../auth';
import { redirect } from '../i18n/navigation';
import { startCourse } from './start';

export type StartCourseState = { error?: 'forbidden' | 'not_found' | 'invalid' } | undefined;

const inputSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
  locale: z.enum(['ru', 'kz']),
});

export async function startCourseAction(_prev: StartCourseState, formData: FormData): Promise<StartCourseState> {
  const parsed = inputSchema.safeParse({ slug: formData.get('slug'), locale: formData.get('locale') });
  if (!parsed.success) return { error: 'invalid' };
  const { slug, locale } = parsed.data;

  // гость → на вход, после входа вернётся на страницу курса
  const user = await requireUser(locale, `/${locale}/courses/${slug}`);

  const result = await startCourse(user.id, slug);
  if (!result.ok) return { error: result.error };
  redirect({ href: `/learn/${result.slug}`, locale });
}
