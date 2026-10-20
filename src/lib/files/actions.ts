'use server';
// Server actions файлов. Тонкая обёртка: requireAdmin → функция из admin.ts → revalidatePath.
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { failure, type ActionResult } from '../admin/result';
import { requireAdmin, type User } from '../auth';
import { clearCourseCover, deleteFile, setCourseCover } from './admin';

type Loc = 'ru' | 'kz';

async function run<T extends object>(localeRaw: string, fn: (actor: User) => Promise<T>): Promise<ActionResult<T>> {
  const locale: Loc = localeRaw === 'kz' ? 'kz' : 'ru';
  const actor = await requireAdmin(locale);
  try {
    const data = await fn(actor);
    revalidatePath(`/${locale}/admin`, 'layout');
    return { ok: true, ...data };
  } catch (e) {
    unstable_rethrow(e);
    return failure(e);
  }
}

export async function setCourseCoverAction(locale: string, courseId: string, fileId: string): Promise<ActionResult<{ cover: string }>> {
  return run(locale, (actor) => setCourseCover(actor, courseId, fileId));
}

export async function clearCourseCoverAction(locale: string, courseId: string): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await clearCourseCover(actor, courseId);
    return {};
  });
}

export async function deleteFileAction(locale: string, fileId: string): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await deleteFile(actor, fileId);
    return {};
  });
}
