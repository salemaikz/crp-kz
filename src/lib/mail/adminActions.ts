'use server';
// Server action страницы «Письма»: сформировать напоминания. Тонкая обёртка над runRemindersAs.
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { failure, type ActionResult } from '@/lib/admin/result';
import { requireAdmin } from '@/lib/auth';
import { runRemindersAs } from '@/lib/reminders/admin';

/** Права проверяются вне try (redirect/notFound должны всплыть), ошибки домена — в результат с кодом. */
export async function runRemindersAction(localeRaw: string): Promise<ActionResult<{ learners: number; digests: number }>> {
  const locale = localeRaw === 'kz' ? 'kz' : 'ru';
  const actor = await requireAdmin(locale);
  try {
    const data = await runRemindersAs(actor);
    revalidatePath(`/${locale}/admin`, 'layout');
    return { ok: true, ...data };
  } catch (e) {
    unstable_rethrow(e);
    return failure(e);
  }
}
