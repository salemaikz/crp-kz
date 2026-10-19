// Отчёт руководителя: сотрудник × назначенный курс. Только сотрудники и зачисления своей организации.
import { getDb } from '../db';
import { dueStatus } from '../format';
import type { L10nRaw } from '../catalog/types';
import type { TeamReportRow, TeamRowStatus, TeamStatusFilter, TeamSummary } from './types';

type EnrollmentRow = {
  enrollmentId: string;
  userId: string;
  courseId: string;
  source: string;
  dueAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  name: string;
  email: string;
  position: string | null;
  slug: string;
  title: L10nRaw;
};

/**
 * Статус строки отчёта. Завершённый курс остаётся «завершён» и после закрытия доступа;
 * иначе сначала доступ (отозван, истёк), затем срок сдачи.
 */
export function rowStatus(
  r: { completed: boolean; dueAt: number | null; revokedAt: number | null; expiresAt: number | null },
  nowMs: number,
): TeamRowStatus {
  if (r.completed) return 'done';
  if (r.revokedAt !== null) return 'revoked';
  if (r.expiresAt !== null && r.expiresAt <= nowMs) return 'expired';
  if (r.dueAt === null) return 'nodue';
  return dueStatus(r.dueAt, nowMs);
}

/** Какая группа фильтра соответствует статусу строки. */
export function statusGroup(status: TeamRowStatus): TeamStatusFilter {
  switch (status) {
    case 'overdue':
      return 'overdue';
    case 'today':
    case 'soon':
      return 'soon';
    case 'done':
      return 'done';
    case 'revoked':
    case 'expired':
      return 'inactive';
    default:
      return 'active';
  }
}

export const STATUS_FILTERS: readonly TeamStatusFilter[] = ['overdue', 'soon', 'active', 'done', 'inactive'];

export function parseStatusFilter(value: unknown): TeamStatusFilter | null {
  const v = Array.isArray(value) ? value[0] : value;
  return (STATUS_FILTERS as readonly unknown[]).includes(v) ? (v as TeamStatusFilter) : null;
}

/**
 * Строки отчёта организации: зачисления с org_id = orgId, у которых пользователь сейчас
 * состоит в этой организации. Прогресс — доля опубликованных уроков; результат теста — среднее
 * из лучших попыток по каждому тесту курса, к которому сотрудник приступал.
 */
export async function buildTeamReport(orgId: string, nowMs: number = Date.now()): Promise<TeamReportRow[]> {
  const db = await getDb();
  const enrollments = await db.sql<EnrollmentRow>`
    SELECT e.id AS enrollment_id, e.user_id, e.course_id, e.source, e.due_at, e.expires_at, e.revoked_at,
           u.name, u.email, m.position, c.slug, c.title
    FROM enrollments e
    JOIN organization_members m ON m.user_id = e.user_id AND m.org_id = ${orgId}
    JOIN users u ON u.id = e.user_id
    JOIN courses c ON c.id = e.course_id
    WHERE e.org_id = ${orgId}
    ORDER BY lower(u.name), c.position, c.id`;
  if (enrollments.length === 0) return [];

  const userIds = [...new Set(enrollments.map((e) => e.userId))];
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];

  const [totals, done, quizzes, certs] = await Promise.all([
    db.sql<{ courseId: string; n: number }>`
      SELECT course_id, count(*) AS n FROM lessons
      WHERE course_id = ANY(${courseIds}) AND status = 'published' GROUP BY course_id`,
    db.sql<{ userId: string; courseId: string; n: number }>`
      SELECT lp.user_id, lp.course_id, count(*) AS n
      FROM lesson_progress lp
      JOIN lessons l ON l.id = lp.lesson_id AND l.course_id = lp.course_id AND l.status = 'published'
      WHERE lp.user_id = ANY(${userIds}) AND lp.course_id = ANY(${courseIds})
      GROUP BY lp.user_id, lp.course_id`,
    // лучшая попытка по каждому тесту (урок + блок)
    db.sql<{ userId: string; courseId: string; best: number; passed: boolean }>`
      SELECT qa.user_id, l.course_id,
             CAST(max(CASE WHEN qa.total > 0 THEN qa.correct * 100.0 / qa.total ELSE 0 END) AS float8) AS best,
             bool_or(qa.passed) AS passed
      FROM quiz_attempts qa
      JOIN lessons l ON l.id = qa.lesson_id AND l.status = 'published'
      WHERE qa.user_id = ANY(${userIds}) AND l.course_id = ANY(${courseIds})
      GROUP BY qa.user_id, l.course_id, qa.lesson_id, qa.block_id`,
    db.sql<{ userId: string; courseId: string; number: string; issuedAt: number }>`
      SELECT user_id, course_id, number, issued_at FROM certificates
      WHERE user_id = ANY(${userIds}) AND course_id = ANY(${courseIds})`,
  ]);

  const key = (u: string, c: string) => `${u}\u0000${c}`;
  const totalBy = new Map(totals.map((r) => [r.courseId, Number(r.n)]));
  const doneBy = new Map(done.map((r) => [key(r.userId, r.courseId), Number(r.n)]));
  const quizBy = new Map<string, { sum: number; attempted: number; passed: number }>();
  for (const q of quizzes) {
    const k = key(q.userId, q.courseId);
    const agg = quizBy.get(k) ?? { sum: 0, attempted: 0, passed: 0 };
    agg.sum += Number(q.best);
    agg.attempted += 1;
    if (q.passed) agg.passed += 1;
    quizBy.set(k, agg);
  }
  const certBy = new Map(certs.map((c) => [key(c.userId, c.courseId), { number: c.number, issuedAt: Number(c.issuedAt) }]));

  return enrollments.map((e): TeamReportRow => {
    const k = key(e.userId, e.courseId);
    const lessonsTotal = totalBy.get(e.courseId) ?? 0;
    const lessonsDone = Math.min(doneBy.get(k) ?? 0, lessonsTotal);
    const quiz = quizBy.get(k);
    const completed = lessonsTotal > 0 && lessonsDone >= lessonsTotal;
    const dueAt = e.dueAt === null ? null : Number(e.dueAt);
    return {
      key: e.enrollmentId,
      userId: e.userId,
      name: e.name,
      email: e.email,
      position: e.position,
      courseId: e.courseId,
      courseSlug: e.slug,
      courseTitle: e.title,
      source: e.source,
      lessonsDone,
      lessonsTotal,
      progress: lessonsTotal > 0 ? Math.round((lessonsDone / lessonsTotal) * 100) : 0,
      quizScore: quiz ? Math.round(quiz.sum / quiz.attempted) : null,
      quizzesAttempted: quiz?.attempted ?? 0,
      quizzesPassed: quiz?.passed ?? 0,
      dueAt,
      status: rowStatus(
        {
          completed,
          dueAt,
          revokedAt: e.revokedAt === null ? null : Number(e.revokedAt),
          expiresAt: e.expiresAt === null ? null : Number(e.expiresAt),
        },
        nowMs,
      ),
      certificate: certBy.get(k) ?? null,
    };
  });
}

export type ReportFilters = { courseId?: string | null; status?: TeamStatusFilter | null };

/** Фильтр строк отчёта: курс и/или группа статусов. */
export function filterReport(rows: readonly TeamReportRow[], filters: ReportFilters): TeamReportRow[] {
  return rows.filter(
    (r) =>
      (!filters.courseId || r.courseId === filters.courseId) &&
      (!filters.status || statusGroup(r.status) === filters.status),
  );
}

/** Сводка для карточек: сотрудники, назначения в работе, просрочено, доля завершивших. */
export function summarize(rows: readonly TeamReportRow[], employees: number): TeamSummary {
  // закрытый доступ (отозван, истёк) в процент завершения не входит; «завершён» учитывается всегда
  const counted = rows.filter((r) => r.status !== 'revoked' && r.status !== 'expired').length;
  const done = rows.filter((r) => r.status === 'done').length;
  const overdue = rows.filter((r) => r.status === 'overdue').length;
  const active = rows.filter((r) => statusGroup(r.status) !== 'done' && statusGroup(r.status) !== 'inactive').length;
  return {
    employees,
    active,
    overdue,
    done,
    counted,
    completionPercent: counted > 0 ? Math.round((done / counted) * 100) : null,
  };
}
