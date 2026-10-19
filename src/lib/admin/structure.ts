// Программа курса: модули и уроки — чтение дерева, добавление, переименование, порядок, удаление, публикация.
// Порядок хранится в position; при перестановке позиции всех соседей перенумеровываются 0..n-1.
import { getDb, isUniqueViolation, newId, now, type Sql } from '../db';
import type { L10n } from '../content/types';
import { writeAudit } from './audit';
import { AdminError } from './errors';
import { assertAdmin, type Actor } from './guard';
import {
  directionSchema,
  lessonCreateSchema,
  moduleInputSchema,
  parseOrThrow,
  toL10n,
  type Direction,
} from './schemas';
import { pickFreeSlug, slugify } from './slug';

export type LessonNode = {
  id: string;
  moduleId: string;
  slug: string;
  title: L10n;
  durationMin: number;
  status: 'draft' | 'published';
  position: number;
  /** Есть ли казахская версия контента (хотя бы один блок). */
  hasKz: boolean;
  /** Блоков в русской версии. */
  blocksRu: number;
};

export type ModuleNode = {
  id: string;
  title: L10n;
  position: number;
  lessons: LessonNode[];
};

// ---------- чтение ----------

export async function getCourseStructure(actor: Actor, courseId: string): Promise<ModuleNode[]> {
  await assertAdmin(actor);
  const db = await getDb();
  const modules = await db.sql<{ id: string; title: L10n; position: number }>`
    SELECT id, title, position FROM course_modules WHERE course_id = ${courseId}
    ORDER BY position, created_at, id`;
  const lessons = await db.sql<LessonNode>`
    SELECT id, module_id, slug, title, duration_min, status, position,
           COALESCE(jsonb_array_length(content->'kz'->'blocks'), 0) > 0 AS has_kz,
           COALESCE(jsonb_array_length(content->'ru'->'blocks'), 0) AS blocks_ru
    FROM lessons WHERE course_id = ${courseId}
    ORDER BY position, created_at, id`;
  return modules.map((m) => ({ ...m, lessons: lessons.filter((l) => l.moduleId === m.id) }));
}

// ---------- общие помощники ----------

async function touchCourse(sql: Sql, courseId: string): Promise<void> {
  await sql`UPDATE courses SET updated_at = ${now()} WHERE id = ${courseId}`;
}

/** Модуль по id (FOR UPDATE) или NOT_FOUND. */
async function lockModule(sql: Sql, moduleId: string) {
  const [m] = await sql<{ id: string; courseId: string; title: L10n }>`
    SELECT id, course_id, title FROM course_modules WHERE id = ${moduleId} FOR UPDATE`;
  if (!m) throw new AdminError('NOT_FOUND');
  return m;
}

async function lessonSlugTaken(sql: Sql, courseId: string, slug: string, exceptId: string | null): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM lessons WHERE course_id = ${courseId} AND slug = ${slug}
      AND (${exceptId}::text IS NULL OR id <> ${exceptId})`;
  return rows.length > 0;
}

/** Меняет местами элемент с соседом; возвращает новый порядок или null, если двигать некуда. */
function swapped<T>(list: T[], index: number, dir: Direction): T[] | null {
  const j = dir === 'up' ? index - 1 : index + 1;
  if (j < 0 || j >= list.length) return null;
  const copy = [...list];
  [copy[index], copy[j]] = [copy[j] as T, copy[index] as T];
  return copy;
}

// ---------- модули ----------

export async function addModule(actor: Actor, courseId: string, raw: unknown): Promise<{ id: string }> {
  await assertAdmin(actor);
  const input = parseOrThrow(moduleInputSchema, raw);
  const db = await getDb();
  return db.tx(async (sql) => {
    const [course] = await sql`SELECT 1 FROM courses WHERE id = ${courseId} FOR UPDATE`;
    if (!course) throw new AdminError('NOT_FOUND');
    const [pos] = await sql<{ next: number }>`
      SELECT COALESCE(max(position) + 1, 0) AS next FROM course_modules WHERE course_id = ${courseId}`;
    const id = newId();
    await sql`
      INSERT INTO course_modules (id, course_id, position, title, created_at)
      VALUES (${id}, ${courseId}, ${pos?.next ?? 0}, ${db.json(toL10n(input.titleRu, input.titleKz))}, ${now()})`;
    await touchCourse(sql, courseId);
    await writeAudit(sql, actor.id, 'module.create', 'module', id, { courseId, title: input.titleRu });
    return { id };
  });
}

export async function renameModule(actor: Actor, moduleId: string, raw: unknown): Promise<void> {
  await assertAdmin(actor);
  const input = parseOrThrow(moduleInputSchema, raw);
  const db = await getDb();
  await db.tx(async (sql) => {
    const m = await lockModule(sql, moduleId);
    await sql`UPDATE course_modules SET title = ${db.json(toL10n(input.titleRu, input.titleKz))} WHERE id = ${moduleId}`;
    await touchCourse(sql, m.courseId);
    await writeAudit(sql, actor.id, 'module.rename', 'module', moduleId, {
      courseId: m.courseId,
      title: input.titleRu,
      was: m.title.ru,
    });
  });
}

export async function moveModule(actor: Actor, moduleId: string, dirRaw: unknown): Promise<boolean> {
  await assertAdmin(actor);
  const dir = parseOrThrow(directionSchema, dirRaw);
  const db = await getDb();
  return db.tx(async (sql) => {
    const m = await lockModule(sql, moduleId);
    const rows = await sql<{ id: string }>`
      SELECT id FROM course_modules WHERE course_id = ${m.courseId} ORDER BY position, created_at, id`;
    const ids = rows.map((r) => r.id);
    const order = swapped(ids, ids.indexOf(moduleId), dir);
    if (!order) return false;
    for (const [i, id] of order.entries()) {
      await sql`UPDATE course_modules SET position = ${i} WHERE id = ${id}`;
    }
    await touchCourse(sql, m.courseId);
    await writeAudit(sql, actor.id, 'module.move', 'module', moduleId, { courseId: m.courseId, title: m.title.ru, dir });
    return true;
  });
}

/** Удалить можно только пустой модуль: уроки с прогрессом слушателей нельзя терять молча. */
export async function deleteModule(actor: Actor, moduleId: string): Promise<void> {
  await assertAdmin(actor);
  const db = await getDb();
  await db.tx(async (sql) => {
    const m = await lockModule(sql, moduleId);
    const [cnt] = await sql<{ n: number }>`SELECT count(*) AS n FROM lessons WHERE module_id = ${moduleId}`;
    if (!cnt || cnt.n > 0) throw new AdminError('MODULE_NOT_EMPTY');
    await sql`DELETE FROM course_modules WHERE id = ${moduleId}`;
    await touchCourse(sql, m.courseId);
    await writeAudit(sql, actor.id, 'module.delete', 'module', moduleId, { courseId: m.courseId, title: m.title.ru });
  });
}

// ---------- уроки ----------

export async function addLesson(
  actor: Actor,
  moduleId: string,
  raw: unknown,
): Promise<{ id: string; slug: string; courseId: string }> {
  await assertAdmin(actor);
  const input = parseOrThrow(lessonCreateSchema, raw);
  const db = await getDb();
  try {
    return await db.tx(async (sql) => {
      const m = await lockModule(sql, moduleId);
      const slug = await pickFreeSlug(slugify(input.titleRu) || 'lesson', (s) => lessonSlugTaken(sql, m.courseId, s, null));
      const [pos] = await sql<{ next: number }>`
        SELECT COALESCE(max(position) + 1, 0) AS next FROM lessons WHERE module_id = ${moduleId}`;
      const id = newId();
      const t = now();
      await sql`
        INSERT INTO lessons (id, course_id, module_id, position, slug, title, content, duration_min, status,
                             created_at, updated_at)
        VALUES (${id}, ${m.courseId}, ${moduleId}, ${pos?.next ?? 0}, ${slug},
                ${db.json(toL10n(input.titleRu, input.titleKz))},
                ${db.json({ ru: { v: 1, blocks: [] } })}, ${input.durationMin}, 'draft', ${t}, ${t})`;
      await touchCourse(sql, m.courseId);
      await writeAudit(sql, actor.id, 'lesson.create', 'lesson', id, {
        courseId: m.courseId,
        moduleId,
        title: input.titleRu,
      });
      return { id, slug, courseId: m.courseId };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError('SLUG_TAKEN', { slug: 'slugTaken' });
    throw e;
  }
}

/**
 * Сдвиг урока вверх/вниз. Первый урок модуля «вверх» уходит в конец предыдущего модуля,
 * последний «вниз» — в начало следующего (сквозной порядок по курсу).
 */
export async function moveLesson(actor: Actor, lessonId: string, dirRaw: unknown): Promise<boolean> {
  await assertAdmin(actor);
  const dir = parseOrThrow(directionSchema, dirRaw);
  const db = await getDb();
  return db.tx(async (sql) => {
    const [lesson] = await sql<{ id: string; courseId: string; moduleId: string; title: L10n }>`
      SELECT id, course_id, module_id, title FROM lessons WHERE id = ${lessonId} FOR UPDATE`;
    if (!lesson) throw new AdminError('NOT_FOUND');
    const modules = await sql<{ id: string }>`
      SELECT id FROM course_modules WHERE course_id = ${lesson.courseId} ORDER BY position, created_at, id`;
    const lessons = await sql<{ id: string; moduleId: string }>`
      SELECT id, module_id FROM lessons WHERE course_id = ${lesson.courseId} ORDER BY position, created_at, id`;
    const byModule = new Map<string, string[]>(modules.map((m) => [m.id, []]));
    for (const l of lessons) byModule.get(l.moduleId)?.push(l.id);

    const mIndex = modules.findIndex((m) => m.id === lesson.moduleId);
    const own = byModule.get(lesson.moduleId) ?? [];
    const idx = own.indexOf(lessonId);
    const touched: string[] = [lesson.moduleId];

    const inside = swapped(own, idx, dir);
    if (inside) {
      byModule.set(lesson.moduleId, inside);
    } else {
      // граница модуля: переносим в соседний
      const neighbour = modules[dir === 'up' ? mIndex - 1 : mIndex + 1];
      if (!neighbour) return false;
      const target = byModule.get(neighbour.id) ?? [];
      byModule.set(lesson.moduleId, own.filter((id) => id !== lessonId));
      byModule.set(neighbour.id, dir === 'up' ? [...target, lessonId] : [lessonId, ...target]);
      touched.push(neighbour.id);
    }

    for (const moduleId of touched) {
      for (const [i, id] of (byModule.get(moduleId) ?? []).entries()) {
        await sql`UPDATE lessons SET module_id = ${moduleId}, position = ${i} WHERE id = ${id}`;
      }
    }
    await touchCourse(sql, lesson.courseId);
    await writeAudit(sql, actor.id, 'lesson.move', 'lesson', lessonId, {
      courseId: lesson.courseId,
      title: lesson.title.ru,
      dir,
    });
    return true;
  });
}

/** Удаление урока: запрещено, если у слушателей есть прогресс или попытки теста — вместо этого «в черновик». */
export async function deleteLesson(actor: Actor, lessonId: string): Promise<void> {
  await assertAdmin(actor);
  const db = await getDb();
  await db.tx(async (sql) => {
    const [lesson] = await sql<{ courseId: string; title: L10n }>`
      SELECT course_id, title FROM lessons WHERE id = ${lessonId} FOR UPDATE`;
    if (!lesson) throw new AdminError('NOT_FOUND');
    const [used] = await sql<{ n: number }>`
      SELECT (SELECT count(*) FROM lesson_progress WHERE lesson_id = ${lessonId})
           + (SELECT count(*) FROM quiz_attempts WHERE lesson_id = ${lessonId}) AS n`;
    if (!used || used.n > 0) throw new AdminError('LESSON_HAS_PROGRESS');
    await sql`DELETE FROM lessons WHERE id = ${lessonId}`;
    await touchCourse(sql, lesson.courseId);
    await writeAudit(sql, actor.id, 'lesson.delete', 'lesson', lessonId, {
      courseId: lesson.courseId,
      title: lesson.title.ru,
    });
  });
}

/** Публикация урока: в черновик — всегда; опубликовать можно урок с русским контентом (хотя бы один блок). */
export async function setLessonStatus(actor: Actor, lessonId: string, status: 'draft' | 'published'): Promise<void> {
  await assertAdmin(actor);
  if (status !== 'draft' && status !== 'published') throw new AdminError('VALIDATION', { status: 'invalid' });
  const db = await getDb();
  await db.tx(async (sql) => {
    const [lesson] = await sql<{ courseId: string; title: L10n; status: string; blocks: number }>`
      SELECT course_id, title, status, COALESCE(jsonb_array_length(content->'ru'->'blocks'), 0) AS blocks
      FROM lessons WHERE id = ${lessonId} FOR UPDATE`;
    if (!lesson) throw new AdminError('NOT_FOUND');
    if (lesson.status === status) return;
    if (status === 'published' && lesson.blocks === 0) throw new AdminError('LESSON_EMPTY', { status: 'lessonEmpty' });
    await sql`UPDATE lessons SET status = ${status}, updated_at = ${now()} WHERE id = ${lessonId}`;
    await touchCourse(sql, lesson.courseId);
    await writeAudit(sql, actor.id, status === 'published' ? 'lesson.publish' : 'lesson.unpublish', 'lesson', lessonId, {
      courseId: lesson.courseId,
      title: lesson.title.ru,
    });
  });
}
