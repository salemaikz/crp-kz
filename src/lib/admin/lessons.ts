// Редактор урока: чтение и сохранение (метаданные + контент ru/kz).
// Контент проверяет validateLessonContent (zod-схемы блоков); ошибки возвращаются путями к полям.
import { getDb, isUniqueViolation, now } from '../db';
import { validateLessonContent } from '../content/blocks';
import type { L10n, LessonContent } from '../content/types';
import { writeAudit } from './audit';
import { AdminError, type ContentIssue, type FieldErrors } from './errors';
import { toContentIssues } from './contentIssues';
import { assertAdmin, type Actor } from './guard';
import { fieldErrorsFromZod, lessonMetaSchema } from './schemas';
import { SLUG_MAX } from './slug';

export type LessonForEdit = {
  id: string;
  courseId: string;
  moduleId: string;
  moduleTitle: L10n;
  courseTitle: L10n;
  courseSlug: string;
  courseStatus: 'draft' | 'published';
  slug: string;
  title: L10n;
  durationMin: number;
  status: 'draft' | 'published';
  content: LessonContent;
  createdAt: number;
  updatedAt: number;
};

export async function getLessonForEdit(actor: Actor, courseId: string, lessonId: string): Promise<LessonForEdit | null> {
  await assertAdmin(actor);
  const db = await getDb();
  const [row] = await db.sql<LessonForEdit>`
    SELECT l.id, l.course_id, l.module_id, m.title AS module_title, c.title AS course_title,
           c.slug AS course_slug, c.status AS course_status, l.slug, l.title, l.duration_min, l.status,
           l.content, l.created_at, l.updated_at
    FROM lessons l
    JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = l.course_id
    WHERE l.id = ${lessonId} AND l.course_id = ${courseId}`;
  return row ?? null;
}

/**
 * Приводит присланный контент к хранимому виду: пустая казахская версия не сохраняется
 * (слушатель увидит русскую), всё остальное проверяет validateLessonContent.
 */
export function normalizeContent(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const { ru, kz } = input as { ru?: unknown; kz?: unknown };
  const kzBlocks = (kz as { blocks?: unknown } | undefined)?.blocks;
  const kzEmpty = kz == null || (Array.isArray(kzBlocks) && kzBlocks.length === 0);
  return kzEmpty ? { ru } : { ru, kz };
}

export type LessonSaveInput = {
  titleRu?: unknown;
  titleKz?: unknown;
  slug?: unknown;
  durationMin?: unknown;
  status?: unknown;
  content?: unknown;
};

export async function updateLesson(
  actor: Actor,
  courseId: string,
  lessonId: string,
  raw: LessonSaveInput,
): Promise<{ slug: string }> {
  await assertAdmin(actor);
  const meta = lessonMetaSchema.safeParse(raw);
  const content = validateLessonContent(normalizeContent(raw.content));

  if (!meta.success || !content.success) {
    const fields: FieldErrors = meta.success ? {} : fieldErrorsFromZod(meta.error);
    const issues: ContentIssue[] = content.success
      ? []
      : toContentIssues(content.error);
    if (!content.success) fields.content = 'invalid';
    throw new AdminError('VALIDATION', fields, issues);
  }

  const m = meta.data;
  const doc = content.data;

  const db = await getDb();
  try {
    return await db.tx(async (sql) => {
      const [cur] = await sql<{ slug: string; title: L10n; status: string }>`
        SELECT slug, title, status FROM lessons WHERE id = ${lessonId} AND course_id = ${courseId} FOR UPDATE`;
      if (!cur) throw new AdminError('NOT_FOUND');
      const status = m.status ?? cur.status;
      if (status === 'published' && doc.ru.blocks.length === 0) {
        throw new AdminError('VALIDATION', { status: 'lessonEmpty' });
      }

      let slug = cur.slug;
      if (m.slug && m.slug !== cur.slug) {
        const taken = await sql`
          SELECT 1 FROM lessons WHERE course_id = ${courseId} AND slug = ${m.slug} AND id <> ${lessonId}`;
        if (taken.length > 0) throw new AdminError('SLUG_TAKEN', { slug: 'slugTaken' });
        slug = m.slug.slice(0, SLUG_MAX);
      }

      const title: L10n = m.titleKz ? { ru: m.titleRu, kz: m.titleKz } : { ru: m.titleRu };
      const t = now();
      await sql`
        UPDATE lessons SET slug = ${slug}, title = ${db.json(title)}, duration_min = ${m.durationMin},
               status = ${status}, content = ${db.json(doc)}, updated_at = ${t}
        WHERE id = ${lessonId}`;
      await sql`UPDATE courses SET updated_at = ${t} WHERE id = ${courseId}`;

      await writeAudit(sql, actor.id, 'lesson.update', 'lesson', lessonId, {
        courseId,
        title: m.titleRu,
        blocksRu: doc.ru.blocks.length,
        blocksKz: doc.kz?.blocks.length ?? 0,
      });
      if (status !== cur.status) {
        await writeAudit(
          sql,
          actor.id,
          status === 'published' ? 'lesson.publish' : 'lesson.unpublish',
          'lesson',
          lessonId,
          { courseId, title: m.titleRu },
        );
      }
      return { slug };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError('SLUG_TAKEN', { slug: 'slugTaken' });
    throw e;
  }
}
