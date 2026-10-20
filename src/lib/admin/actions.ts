'use server';
// Server actions админки. Тонкая обёртка: requireAdmin → функция из src/lib/admin → revalidatePath.
// Логика, проверки прав и валидация живут в самих функциях (их тестируют без Next).
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { requireAdmin, type User } from '@/lib/auth';
import { addLesson, addModule, deleteLesson, deleteModule, moveLesson, moveModule, renameModule, setLessonStatus } from './structure';
import { createCourse, deleteCourse, setCourseStatus, updateCourse } from './courses';
import { updateLesson } from './lessons';
import { changeRole, grantAccess, revokeAccess } from './users';
import { failure, type ActionResult } from './result';
import { sendResetLink } from './userCard';

type Loc = 'ru' | 'kz';

const localeOf = (raw: string): Loc => (raw === 'kz' ? 'kz' : 'ru');

/** FormData → простой объект строк (для zod в функциях). */
function fields(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

/**
 * Общая обёртка: проверка администратора вне try (redirect/notFound должны всплыть),
 * ошибки AdminError → результат с кодом, остальные — GENERIC.
 */
async function run<T extends object>(
  localeRaw: string,
  fn: (actor: User, locale: Loc) => Promise<T>,
): Promise<ActionResult<T>> {
  const locale = localeOf(localeRaw);
  const actor = await requireAdmin(locale);
  try {
    const data = await fn(actor, locale);
    revalidatePath(`/${locale}/admin`, 'layout');
    return { ok: true, ...data };
  } catch (e) {
    unstable_rethrow(e);
    return failure(e);
  }
}

// ---------- курсы ----------

export async function createCourseAction(locale: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await run(locale, async (actor) => createCourse(actor, fields(formData)));
  if (res.ok) redirect(`/${localeOf(locale)}/admin/courses/${res.id}`);
  return res;
}

export async function updateCourseAction(
  locale: string,
  courseId: string,
  formData: FormData,
): Promise<ActionResult<{ slug: string }>> {
  return run(locale, (actor) => updateCourse(actor, courseId, fields(formData)));
}

export async function setCourseStatusAction(
  locale: string,
  courseId: string,
  status: 'draft' | 'published',
): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await setCourseStatus(actor, courseId, status);
    return {};
  });
}

export async function deleteCourseAction(locale: string, courseId: string): Promise<ActionResult> {
  const res = await run(locale, async (actor) => {
    await deleteCourse(actor, courseId);
    return {};
  });
  if (res.ok) redirect(`/${localeOf(locale)}/admin/courses`);
  return res;
}

// ---------- модули ----------

export async function addModuleAction(locale: string, courseId: string, formData: FormData): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await addModule(actor, courseId, fields(formData));
    return {};
  });
}

export async function renameModuleAction(locale: string, moduleId: string, formData: FormData): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await renameModule(actor, moduleId, fields(formData));
    return {};
  });
}

export async function moveModuleAction(locale: string, moduleId: string, dir: 'up' | 'down'): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await moveModule(actor, moduleId, dir);
    return {};
  });
}

export async function deleteModuleAction(locale: string, moduleId: string): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await deleteModule(actor, moduleId);
    return {};
  });
}

// ---------- уроки ----------

export async function addLessonAction(locale: string, moduleId: string, formData: FormData): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await addLesson(actor, moduleId, fields(formData));
    return {};
  });
}

export async function moveLessonAction(locale: string, lessonId: string, dir: 'up' | 'down'): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await moveLesson(actor, lessonId, dir);
    return {};
  });
}

export async function deleteLessonAction(locale: string, lessonId: string): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await deleteLesson(actor, lessonId);
    return {};
  });
}

export async function setLessonStatusAction(
  locale: string,
  lessonId: string,
  status: 'draft' | 'published',
): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await setLessonStatus(actor, lessonId, status);
    return {};
  });
}

/** Сохранение урока из редактора: payload — объект с метаданными и content {ru, kz?}. */
export async function saveLessonAction(
  locale: string,
  courseId: string,
  lessonId: string,
  payload: unknown,
): Promise<ActionResult<{ slug: string; savedAt: number }>> {
  return run(locale, async (actor) => {
    const body = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const { slug } = await updateLesson(actor, courseId, lessonId, body);
    return { slug, savedAt: Date.now() };
  });
}

// ---------- пользователи ----------

export async function grantAccessAction(locale: string, userId: string, formData: FormData): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await grantAccess(actor, { ...fields(formData), userId });
    return {};
  });
}

export async function revokeAccessAction(locale: string, userId: string, courseId: string): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await revokeAccess(actor, userId, courseId);
    return {};
  });
}

/**
 * Ссылка для смены пароля из карточки пользователя. «Поставлено в очередь» (ok) — только когда письмо
 * действительно встало в очередь; иначе error = причина (not_found, demo_seed, rate_limited, global_cap, unavailable).
 */
export async function sendResetLinkAction(locale: string, userId: string): Promise<ActionResult> {
  const loc = localeOf(locale);
  const actor = await requireAdmin(loc);
  try {
    const res = await sendResetLink(actor, userId);
    if (!res.sent) return { ok: false, error: res.reason };
    revalidatePath(`/${loc}/admin`, 'layout');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return failure(e);
  }
}

export async function changeRoleAction(locale: string, userId: string, formData: FormData): Promise<ActionResult> {
  return run(locale, async (actor) => {
    await changeRole(actor, { ...fields(formData), userId });
    return {};
  });
}
