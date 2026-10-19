// Единая проверка доступа слушателя: курс и урок опубликованы, есть действующее зачисление,
// урок не закрыт порядком прохождения. Страницы и server actions идут через эти функции.
import { canAccessCourse } from '../access';
import type { L10n, Locale } from '../content/types';
import { getDb } from '../db';
import { pickLessonDoc, type PickedDoc } from './content';
import { getCourse, getDoneLessonIds, getOutlineModules, type CourseRef } from './data';
import { LearnError } from './errors';
import { buildProgress } from './outline';
import type { CourseAccess, LessonNode } from './types';

/**
 * Доступ к курсу. not_found — курса нет или он черновик (404); denied — курс виден,
 * но зачисления нет, оно истекло или отозвано. Закрытый курс (internal/private) без
 * какого-либо зачисления не раскрываем: для чужого это тоже not_found.
 */
export async function loadCourseAccess(userId: string, ref: CourseRef): Promise<CourseAccess> {
  const course = await getCourse(ref);
  if (!course || course.status !== 'published') return { status: 'not_found' };

  const access = await canAccessCourse(userId, course.id);
  if (!access.ok) {
    const reason = access.reason ?? 'none';
    if (reason === 'none' && course.visibility !== 'public') return { status: 'not_found' };
    return { status: 'denied', course, reason, enrollment: access.enrollment ?? null };
  }

  const [modules, done] = await Promise.all([getOutlineModules(course.id), getDoneLessonIds(userId, course.id)]);
  return {
    status: 'ok',
    course,
    enrollment: access.enrollment as NonNullable<typeof access.enrollment>,
    progress: buildProgress(modules, done, course.sequential),
  };
}

export type LessonGate = {
  access: Extract<CourseAccess, { status: 'ok' }>;
  node: LessonNode;
  picked: PickedDoc;
  lesson: { id: string; slug: string; title: L10n; durationMin: number };
};

/**
 * Урок для мутаций (тест, «пройден»): всё проверяется заново по id урока, ничему из клиента не верим.
 * Бросает LearnError: not_found / forbidden / locked / bad_content.
 */
export async function loadLessonForAction(userId: string, lessonId: string, locale: Locale): Promise<LessonGate> {
  const db = await getDb();
  const [row] = await db.sql<{ courseId: string; slug: string; title: L10n; durationMin: number; content: unknown }>`
    SELECT course_id, slug, title, duration_min, content
    FROM lessons WHERE id = ${lessonId} AND status = 'published'`;
  if (!row) throw new LearnError('not_found');

  const access = await loadCourseAccess(userId, { id: row.courseId });
  if (access.status === 'not_found') throw new LearnError('not_found');
  if (access.status === 'denied') throw new LearnError('forbidden', { reason: access.reason });

  const node = access.progress.lessons.find((l) => l.id === lessonId);
  if (!node) throw new LearnError('not_found');
  if (node.state === 'locked') throw new LearnError('locked');

  const picked = pickLessonDoc(row.content, locale);
  if (!picked) throw new LearnError('bad_content');
  return {
    access,
    node,
    picked,
    lesson: { id: lessonId, slug: row.slug, title: row.title, durationMin: row.durationMin },
  };
}
