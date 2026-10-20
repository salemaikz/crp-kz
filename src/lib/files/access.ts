// Кто может прочитать файл (D-034). Проверяется на каждый запрос выдачи; второй реализации
// доступа к урокам нет: зачисление, срок, отзыв, публикация и порядок прохождения — из учебного слоя.
import { getDb } from '../db';
import { isDemo } from '../env';
import { loadCourseAccess } from '../learn/gate';
import type { FileRow } from './types';

export type FileReadDecision = { ok: true; cache: 'public' | 'private' } | { ok: false };

const DENY: FileReadDecision = { ok: false };
const PRIVATE: FileReadDecision = { ok: true, cache: 'private' };

type Viewer = { id: string; role: string } | null;

/**
 * Решение о доступе. Роль админа сверяется с БД (сессия могла устареть).
 *
 * Публичное демо (пароль демо-админа открыт, любой может загрузить файл): документы (PDF, DOCX и т. п.)
 * видит только администратор, чтобы демо не раздавало чужие файлы с нашего домена. Остальные получают
 * тот же отказ, что и при отсутствии доступа. Изображения (обложки и картинки уроков) очищены от
 * метаданных и отдаются с nosniff и CSP sandbox, поэтому идут по обычным правилам: слушательскую часть
 * (обложка у гостя, картинка в уроке) в демо можно принять.
 */
export async function canReadFile(user: Viewer, file: FileRow): Promise<FileReadDecision> {
  if (file.status !== 'active') return DENY;
  const db = await getDb();

  let isAdmin = false;
  if (user) {
    const [row] = await db.sql<{ role: string }>`SELECT role FROM users WHERE id = ${user.id}`;
    isAdmin = row?.role === 'admin';
  }
  if (isAdmin) return PRIVATE; // админу видны и черновики
  if (isDemo() && file.kind === 'document') return DENY;

  if (file.purpose === 'course_cover') return canReadCover(user, file);
  if (file.purpose === 'lesson_material') return canReadMaterial(user, file);
  return DENY; // 'submission' (#21): правила появятся вместе с практическими заданиями
}

async function canReadCover(user: Viewer, file: FileRow): Promise<FileReadDecision> {
  const db = await getDb();
  const [course] = await db.sql<{ id: string; visibility: string; ownerOrgId: string | null }>`
    SELECT id, visibility, owner_org_id FROM courses WHERE cover_file_id = ${file.id} AND status = 'published'`;
  if (!course) return DENY;
  if (course.visibility === 'public') return { ok: true, cache: 'public' };
  if (!user) return DENY;

  const [enrolled] = await db.sql`SELECT 1 FROM enrollments WHERE user_id = ${user.id} AND course_id = ${course.id}`;
  if (enrolled) return PRIVATE;
  if (course.visibility === 'internal' && course.ownerOrgId) {
    const [member] = await db.sql`
      SELECT 1 FROM organization_members WHERE user_id = ${user.id} AND org_id = ${course.ownerOrgId}`;
    if (member) return PRIVATE;
  }
  return DENY;
}

async function canReadMaterial(user: Viewer, file: FileRow): Promise<FileReadDecision> {
  if (!user) return DENY;
  const db = await getDb();
  // Только опубликованные уроки: файл черновика слушателю недоступен.
  const lessons = await db.sql<{ lessonId: string; courseId: string }>`
    SELECT l.id AS lesson_id, l.course_id
    FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id
    WHERE lf.file_id = ${file.id} AND l.status = 'published'`;
  const courseIds = [...new Set(lessons.map((l) => l.courseId))];
  for (const courseId of courseIds) {
    const access = await loadCourseAccess(user.id, { id: courseId });
    if (access.status !== 'ok') continue;
    const open = new Set(access.progress.lessons.filter((n) => n.state !== 'locked').map((n) => n.id));
    if (lessons.some((l) => l.courseId === courseId && open.has(l.lessonId))) return PRIVATE;
  }
  return DENY;
}
