// Админские операции с файлами: список, занятое место, обложка, удаление.
// Каждая функция начинает с assertAdmin; при неактивном флаге — AdminError('FEATURE_DISABLED').
import { AdminError } from '../admin/errors';
import { assertAdmin, type Actor } from '../admin/guard';
import { writeAudit } from '../audit';
import type { L10n } from '../content/types';
import { getDb, now } from '../db';
import { isFeatureActive } from '../features';
import { quotaConfig } from '../storage/config';
import { getStorage } from '../storage';
import type { FileRow, StoredFile } from './types';
import { fileUrl } from './url';

export type CourseFileItem = StoredFile & {
  createdAt: number;
  uploadedByName: string | null;
  usedIn: Array<{ lessonId: string; title: L10n }>;
  isCover: boolean;
};

async function guard(actor: Actor): Promise<void> {
  await assertAdmin(actor);
  if (!isFeatureActive('UPLOADS')) throw new AdminError('FEATURE_DISABLED');
}

export async function listCourseFiles(actor: Actor, courseId: string): Promise<CourseFileItem[]> {
  await guard(actor);
  const db = await getDb();
  const files = await db.sql<FileRow & { uploadedByName: string | null }>`
    SELECT f.*, u.name AS uploaded_by_name
    FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.course_id = ${courseId} AND f.status = 'active'
    ORDER BY f.created_at DESC, f.id`;
  if (files.length === 0) return [];
  const ids = files.map((f) => f.id);
  const uses = await db.sql<{ fileId: string; lessonId: string; title: L10n }>`
    SELECT lf.file_id, l.id AS lesson_id, l.title
    FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id
    WHERE lf.file_id = ANY(${ids}) ORDER BY l.created_at, l.id`;
  const [course] = await db.sql<{ coverFileId: string | null }>`SELECT cover_file_id FROM courses WHERE id = ${courseId}`;
  return files.map((f) => ({
    id: f.id,
    url: fileUrl(f.id),
    name: f.originalName,
    kind: f.kind,
    ext: f.ext,
    mime: f.mime,
    sizeBytes: f.sizeBytes,
    width: f.width,
    height: f.height,
    createdAt: f.createdAt,
    uploadedByName: f.uploadedByName,
    usedIn: uses.filter((u) => u.fileId === f.id).map((u) => ({ lessonId: u.lessonId, title: u.title })),
    isCover: course?.coverFileId === f.id,
  }));
}

export async function storageUsage(
  actor: Actor,
  courseId: string,
): Promise<{ courseBytes: number; courseQuota: number; totalBytes: number; totalQuota: number }> {
  await guard(actor);
  const db = await getDb();
  const [row] = await db.sql<{ total: number; course: number }>`
    SELECT COALESCE(SUM(size_bytes), 0)::float8 AS total,
           COALESCE(SUM(size_bytes) FILTER (WHERE course_id = ${courseId}), 0)::float8 AS course
    FROM files WHERE status = 'active'`;
  const q = quotaConfig();
  return { courseBytes: Number(row?.course ?? 0), courseQuota: q.course, totalBytes: Number(row?.total ?? 0), totalQuota: q.total };
}

/** Обложка: courses.cover и cover_file_id пишутся одним UPDATE. */
export async function setCourseCover(actor: Actor, courseId: string, fileId: string): Promise<{ cover: string }> {
  await guard(actor);
  const db = await getDb();
  return db.tx(async (sql) => {
    const [course] = await sql`SELECT 1 FROM courses WHERE id = ${courseId} FOR UPDATE`;
    if (!course) throw new AdminError('NOT_FOUND');
    const [file] = await sql<Pick<FileRow, 'id' | 'status' | 'purpose' | 'kind' | 'courseId'>>`
      SELECT id, status, purpose, kind, course_id FROM files WHERE id = ${fileId} FOR SHARE`;
    if (!file || file.status !== 'active') throw new AdminError('FILE_NOT_FOUND');
    if (file.purpose !== 'course_cover' || file.kind !== 'image' || file.courseId !== courseId) {
      throw new AdminError('VALIDATION', { file: 'invalid' });
    }
    const cover = fileUrl(file.id);
    await sql`UPDATE courses SET cover = ${cover}, cover_file_id = ${file.id}, updated_at = ${now()} WHERE id = ${courseId}`;
    await writeAudit(sql, { actorId: actor.id, action: 'course.cover_set', entity: 'course', entityId: courseId, meta: { fileId: file.id } });
    return { cover };
  });
}

export async function clearCourseCover(actor: Actor, courseId: string): Promise<void> {
  await guard(actor);
  const db = await getDb();
  await db.tx(async (sql) => {
    const [course] = await sql<{ coverFileId: string | null; cover: string | null }>`
      SELECT cover_file_id, cover FROM courses WHERE id = ${courseId} FOR UPDATE`;
    if (!course) throw new AdminError('NOT_FOUND');
    if (course.coverFileId === null && course.cover === null) return;
    await sql`UPDATE courses SET cover = NULL, cover_file_id = NULL, updated_at = ${now()} WHERE id = ${courseId}`;
    await writeAudit(sql, {
      actorId: actor.id,
      action: 'course.cover_clear',
      entity: 'course',
      entityId: courseId,
      meta: { fileId: course.coverFileId },
    });
  });
}

/** Логическое удаление: status='deleted'; объект убирается после коммита. FILE_IN_USE — есть ссылки или это обложка. */
export async function deleteFile(actor: Actor, fileId: string): Promise<void> {
  await guard(actor);
  const db = await getDb();
  const removed = await db.tx(async (sql) => {
    const [file] = await sql<Pick<FileRow, 'id' | 'status' | 'storageKey' | 'courseId' | 'purpose'>>`
      SELECT id, status, storage_key, course_id, purpose FROM files WHERE id = ${fileId} FOR UPDATE`;
    if (!file || file.status !== 'active') throw new AdminError('FILE_NOT_FOUND');
    // проверка ссылок — после блокировки строки, новым запросом (сохранение урока берёт FOR SHARE)
    const [used] = await sql`
      SELECT 1 WHERE EXISTS (SELECT 1 FROM lesson_files WHERE file_id = ${fileId})
                  OR EXISTS (SELECT 1 FROM courses WHERE cover_file_id = ${fileId})`;
    if (used) throw new AdminError('FILE_IN_USE');
    await sql`UPDATE files SET status = 'deleted', deleted_at = ${now()} WHERE id = ${fileId}`;
    await writeAudit(sql, {
      actorId: actor.id,
      action: 'file.delete',
      entity: 'file',
      entityId: fileId,
      meta: { courseId: file.courseId, purpose: file.purpose },
    });
    return file.storageKey;
  });
  try {
    await getStorage().remove(removed);
  } catch {
    // строка уже deleted: бесхозный объект уберёт подметание
  }
}
