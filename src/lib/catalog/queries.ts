// Чтение каталога: курсы, программа, прогресс зрителя. Только SELECT, без побочных эффектов.
import { enrollmentState, listEnrollments } from '../access';
import { getDb } from '../db';
import { visibleCover } from '../files/url';
import type {
  CatalogCourse,
  CourseDetail,
  CourseLevel,
  CourseVisibility,
  L10nRaw,
  ProgramModule,
  ViewerCourseState,
} from './types';
import { isCourseVisible, isFreeCourse } from './visibility';

type CourseRow = {
  id: string;
  slug: string;
  title: L10nRaw;
  summary: L10nRaw;
  description: L10nRaw;
  cover: string | null;
  level: CourseLevel | null;
  durationMin: number;
  visibility: CourseVisibility;
  status: 'draft' | 'published';
  ownerOrgId: string | null;
  ownerOrgName: string | null;
  ownerOrgKind: 'owner' | 'client' | null;
  sequential: boolean;
  position: number;
  priceKzt: number | null;
  accessDays: number | null;
  offerActive: boolean | null;
  modulesCount: number;
  lessonsCount: number;
};

function toCourse(r: CourseRow): CatalogCourse {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    cover: visibleCover(r.cover),
    level: r.level,
    durationMin: Number(r.durationMin) || 0,
    visibility: r.visibility,
    status: r.status,
    ownerOrgId: r.ownerOrgId,
    ownerOrgName: r.ownerOrgName,
    ownerOrgKind: r.ownerOrgKind,
    position: Number(r.position) || 0,
    priceKzt: r.priceKzt === null ? null : Number(r.priceKzt),
    accessDays: r.accessDays === null ? null : Number(r.accessDays),
    offerActive: r.offerActive === true,
    modulesCount: Number(r.modulesCount) || 0,
    lessonsCount: Number(r.lessonsCount) || 0,
  };
}

/** Один и тот же набор колонок для списка и страницы курса. */
async function selectCourses(where: { slug: string } | { orgIds: string[] }): Promise<CourseRow[]> {
  const db = await getDb();
  // Опубликованные уроки и модули, в которых есть хотя бы один опубликованный урок.
  if ('slug' in where) {
    return db.sql<CourseRow>`
      SELECT c.id, c.slug, c.title, c.summary, c.description, c.cover, c.level, c.duration_min, c.visibility,
             c.status, c.owner_org_id, c.sequential, c.position,
             org.name AS owner_org_name, org.kind AS owner_org_kind,
             o.price_kzt, o.access_days, o.active AS offer_active,
             (SELECT count(*) FROM lessons l WHERE l.course_id = c.id AND l.status = 'published') AS lessons_count,
             (SELECT count(*) FROM course_modules m WHERE m.course_id = c.id AND EXISTS (
                SELECT 1 FROM lessons l WHERE l.module_id = m.id AND l.status = 'published')) AS modules_count
      FROM courses c
      LEFT JOIN course_offers o ON o.course_id = c.id
      LEFT JOIN organizations org ON org.id = c.owner_org_id
      WHERE c.slug = ${where.slug}`;
  }
  // пустой список организаций → заведомо несуществующий id, чтобы не отправлять пустой массив
  const orgIds = where.orgIds.length > 0 ? where.orgIds : [''];
  return db.sql<CourseRow>`
    SELECT c.id, c.slug, c.title, c.summary, c.description, c.cover, c.level, c.duration_min, c.visibility,
           c.status, c.owner_org_id, c.sequential, c.position,
           org.name AS owner_org_name, org.kind AS owner_org_kind,
           o.price_kzt, o.access_days, o.active AS offer_active,
           (SELECT count(*) FROM lessons l WHERE l.course_id = c.id AND l.status = 'published') AS lessons_count,
           (SELECT count(*) FROM course_modules m WHERE m.course_id = c.id AND EXISTS (
              SELECT 1 FROM lessons l WHERE l.module_id = m.id AND l.status = 'published')) AS modules_count
    FROM courses c
    LEFT JOIN course_offers o ON o.course_id = c.id
    LEFT JOIN organizations org ON org.id = c.owner_org_id
    WHERE c.status = 'published'
      AND (c.visibility = 'public' OR (c.visibility = 'internal' AND c.owner_org_id = ANY(${orgIds})))
    ORDER BY c.position, c.created_at, c.id`;
}

/** Организации пользователя (любая роль): для видимости internal-курсов. */
export async function getMemberOrgIds(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const db = await getDb();
  const rows = await db.sql<{ orgId: string }>`SELECT org_id FROM organization_members WHERE user_id = ${userId}`;
  return rows.map((r) => r.orgId);
}

/**
 * Курсы каталога: опубликованные public + internal организаций пользователя.
 * Гость (memberOrgIds пуст) видит только public. Лишнее отсекается ещё раз в JS (isCourseVisible).
 */
export async function listCatalogCourses(memberOrgIds: readonly string[]): Promise<CatalogCourse[]> {
  const rows = await selectCourses({ orgIds: [...memberOrgIds] });
  return rows.map(toCourse).filter((c) => isCourseVisible(c, memberOrgIds));
}

/** Курс по slug или null — если нет, черновик, private или internal не для этого зрителя. */
export async function getCourseDetail(slug: string, memberOrgIds: readonly string[]): Promise<CourseDetail | null> {
  const [row] = await selectCourses({ slug });
  if (!row) return null;
  const course = toCourse(row);
  if (!isCourseVisible(course, memberOrgIds)) return null;
  return { ...course, description: row.description, sequential: Boolean(row.sequential) };
}

/** Программа курса: модули и опубликованные уроки (только названия и длительность). */
export async function getCourseProgram(courseId: string): Promise<ProgramModule[]> {
  const db = await getDb();
  const rows = await db.sql<{
    moduleId: string;
    moduleTitle: L10nRaw;
    lessonId: string;
    lessonTitle: L10nRaw;
    durationMin: number;
  }>`
    SELECT m.id AS module_id, m.title AS module_title, l.id AS lesson_id, l.title AS lesson_title, l.duration_min
    FROM course_modules m
    JOIN lessons l ON l.module_id = m.id AND l.course_id = m.course_id AND l.status = 'published'
    WHERE m.course_id = ${courseId}
    ORDER BY m.position, m.created_at, m.id, l.position, l.created_at, l.id`;
  const modules: ProgramModule[] = [];
  for (const r of rows) {
    let mod = modules[modules.length - 1];
    if (!mod || mod.id !== r.moduleId) {
      mod = { id: r.moduleId, title: r.moduleTitle, lessons: [], durationMin: 0 };
      modules.push(mod);
    }
    const durationMin = Number(r.durationMin) || 0;
    mod.lessons.push({ id: r.lessonId, title: r.lessonTitle, durationMin });
    mod.durationMin += durationMin;
  }
  return modules;
}

/**
 * Состояние зачисления и прогресс зрителя по курсам: доступ (lib/access), срок сдачи, доля
 * пройденных опубликованных уроков. Курсы без зачисления в карту не попадают.
 */
export async function getViewerStates(
  userId: string,
  courses: ReadonlyArray<Pick<CatalogCourse, 'id' | 'lessonsCount'>>,
  nowMs: number = Date.now(),
): Promise<Map<string, ViewerCourseState>> {
  const out = new Map<string, ViewerCourseState>();
  if (courses.length === 0) return out;
  const enrollments = await listEnrollments(userId);
  const wanted = new Map(courses.map((c) => [c.id, c]));
  const mine = enrollments.filter((e) => wanted.has(e.courseId));
  if (mine.length === 0) return out;

  const db = await getDb();
  const ids = mine.map((e) => e.courseId);
  const done = await db.sql<{ courseId: string; n: number }>`
    SELECT lp.course_id, count(*) AS n
    FROM lesson_progress lp
    JOIN lessons l ON l.id = lp.lesson_id AND l.course_id = lp.course_id AND l.status = 'published'
    WHERE lp.user_id = ${userId} AND lp.course_id = ANY(${ids})
    GROUP BY lp.course_id`;
  const doneBy = new Map(done.map((d) => [d.courseId, Number(d.n)]));

  for (const e of mine) {
    const total = wanted.get(e.courseId)?.lessonsCount ?? 0;
    const lessonsDone = Math.min(doneBy.get(e.courseId) ?? 0, total);
    out.set(e.courseId, {
      access: enrollmentState(e, nowMs),
      dueAt: e.dueAt,
      source: e.source,
      expiresAt: e.expiresAt,
      lessonsDone,
      lessonsTotal: total,
      percent: total > 0 ? Math.round((lessonsDone / total) * 100) : 0,
    });
  }
  return out;
}

export type CatalogStats = { courses: number; lessons: number };

/** Цифры для лендинга: публичные опубликованные курсы и их опубликованные уроки. */
export async function getCatalogStats(): Promise<CatalogStats> {
  const db = await getDb();
  const [row] = await db.sql<{ courses: number; lessons: number }>`
    SELECT
      (SELECT count(*) FROM courses WHERE status = 'published' AND visibility = 'public') AS courses,
      (SELECT count(*) FROM lessons l JOIN courses c ON c.id = l.course_id
        WHERE l.status = 'published' AND c.status = 'published' AND c.visibility = 'public') AS lessons`;
  return { courses: Number(row?.courses ?? 0), lessons: Number(row?.lessons ?? 0) };
}

/** Витрина лендинга: первые публичные курсы (порядок — поле position). */
export async function listFeaturedCourses(limit = 3): Promise<CatalogCourse[]> {
  const all = await listCatalogCourses([]);
  return all.slice(0, limit);
}

export { isFreeCourse };
