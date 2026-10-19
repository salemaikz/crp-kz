// Запросы слоя «обучение». Только опубликованные уроки; контент урока грузим отдельно и по одному.
import { enrollmentState, listEnrollments, type AccessResult, type Enrollment } from '../access';
import type { L10n, Locale } from '../content/types';
import { getDb, type Sql } from '../db';
import { contentHasQuiz } from './content';
import { buildProgress } from './outline';
import type {
  CertificateListItem,
  CourseInfo,
  CourseProgress,
  OutlineLesson,
  OutlineModule,
} from './types';

export type CourseRef = { slug: string } | { id: string };

async function q(sql?: Sql): Promise<Sql> {
  return sql ?? (await getDb()).sql;
}

export async function getCourse(ref: CourseRef, sql?: Sql): Promise<CourseInfo | null> {
  const s = await q(sql);
  const rows =
    'slug' in ref
      ? await s<CourseInfo>`
          SELECT id, slug, title, summary, cover, level, duration_min, sequential, status, visibility
          FROM courses WHERE slug = ${ref.slug}`
      : await s<CourseInfo>`
          SELECT id, slug, title, summary, cover, level, duration_min, sequential, status, visibility
          FROM courses WHERE id = ${ref.id}`;
  return rows[0] ?? null;
}

type OutlineRow = OutlineLesson & { moduleTitle: L10n; courseId: string };

function groupModules(rows: readonly OutlineRow[]): OutlineModule[] {
  const out: OutlineModule[] = [];
  for (const r of rows) {
    let m = out[out.length - 1];
    if (!m || m.id !== r.moduleId) {
      m = { id: r.moduleId, title: r.moduleTitle, lessons: [] };
      out.push(m);
    }
    m.lessons.push({ id: r.id, slug: r.slug, title: r.title, durationMin: r.durationMin, moduleId: r.moduleId });
  }
  return out;
}

/** Модули с опубликованными уроками по порядку; модуль без опубликованных уроков не попадает. */
export async function getOutlineModules(courseId: string, sql?: Sql): Promise<OutlineModule[]> {
  const s = await q(sql);
  const rows = await s<OutlineRow>`
    SELECT l.id, l.slug, l.title, l.duration_min, l.module_id, l.course_id, m.title AS module_title
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    WHERE l.course_id = ${courseId} AND l.status = 'published'
    ORDER BY m.position, m.created_at, m.id, l.position, l.created_at, l.id`;
  return groupModules(rows);
}

/** Пройденные уроки курса (включая уроки, снятые с публикации, — их отфильтрует buildProgress). */
export async function getDoneLessonIds(userId: string, courseId: string, sql?: Sql): Promise<Set<string>> {
  const s = await q(sql);
  const rows = await s<{ lessonId: string }>`
    SELECT lesson_id FROM lesson_progress WHERE user_id = ${userId} AND course_id = ${courseId}`;
  return new Set(rows.map((r) => r.lessonId));
}

export async function getLessonContent(lessonId: string, sql?: Sql): Promise<unknown> {
  const s = await q(sql);
  const [row] = await s<{ content: unknown }>`SELECT content FROM lessons WHERE id = ${lessonId}`;
  return row?.content ?? null;
}

/** Id уроков курса, где в показываемом документе есть тест. */
export async function getQuizLessonIds(courseId: string, locale: Locale, sql?: Sql): Promise<Set<string>> {
  const s = await q(sql);
  const rows = await s<{ id: string; content: unknown }>`
    SELECT id, content FROM lessons WHERE course_id = ${courseId} AND status = 'published'`;
  return new Set(rows.filter((r) => contentHasQuiz(r.content, locale)).map((r) => r.id));
}

export type LearnerCourse = {
  enrollment: Enrollment;
  access: AccessResult;
  course: CourseInfo;
  progress: CourseProgress;
  certificateNumber: string | null;
};

/**
 * Все зачисления пользователя на опубликованные курсы с прогрессом и номером сертификата.
 * Пять запросов независимо от числа курсов.
 */
export async function listLearnerCourses(userId: string, sql?: Sql): Promise<LearnerCourse[]> {
  const s = await q(sql);
  const enrollments = await listEnrollments(userId, s);
  if (enrollments.length === 0) return [];
  const ids = enrollments.map((e) => e.courseId);

  const courses = await s<CourseInfo>`
    SELECT id, slug, title, summary, cover, level, duration_min, sequential, status, visibility
    FROM courses WHERE id = ANY(${ids}) AND status = 'published'`;
  const lessonRows = await s<OutlineRow>`
    SELECT l.id, l.slug, l.title, l.duration_min, l.module_id, l.course_id, m.title AS module_title
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    WHERE l.course_id = ANY(${ids}) AND l.status = 'published'
    ORDER BY l.course_id, m.position, m.created_at, m.id, l.position, l.created_at, l.id`;
  const doneRows = await s<{ lessonId: string; courseId: string }>`
    SELECT lesson_id, course_id FROM lesson_progress WHERE user_id = ${userId} AND course_id = ANY(${ids})`;
  const certRows = await s<{ courseId: string; number: string }>`
    SELECT course_id, number FROM certificates WHERE user_id = ${userId} AND course_id = ANY(${ids})`;

  const byCourse = new Map<string, OutlineRow[]>();
  for (const r of lessonRows) byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]);
  const doneByCourse = new Map<string, Set<string>>();
  for (const r of doneRows) doneByCourse.set(r.courseId, (doneByCourse.get(r.courseId) ?? new Set()).add(r.lessonId));
  const certByCourse = new Map(certRows.map((r) => [r.courseId, r.number]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const out: LearnerCourse[] = [];
  for (const enrollment of enrollments) {
    const course = courseById.get(enrollment.courseId);
    if (!course) continue; // черновик или удалённый курс слушателю не виден
    const progress = buildProgress(
      groupModules(byCourse.get(course.id) ?? []),
      doneByCourse.get(course.id) ?? new Set(),
      course.sequential,
    );
    out.push({
      enrollment,
      access: enrollmentState(enrollment),
      course,
      progress,
      certificateNumber: certByCourse.get(course.id) ?? null,
    });
  }
  return out;
}

/** Сертификаты пользователя с курсом, новые сверху. */
export async function listCertificates(userId: string, sql?: Sql): Promise<CertificateListItem[]> {
  const s = await q(sql);
  return s<CertificateListItem>`
    SELECT ce.id, ce.number, ce.user_id, ce.course_id, ce.holder_name, ce.locale, ce.issued_at,
           c.slug AS course_slug, c.title AS course_title
    FROM certificates ce JOIN courses c ON c.id = ce.course_id
    WHERE ce.user_id = ${userId}
    ORDER BY ce.issued_at DESC, ce.id`;
}
