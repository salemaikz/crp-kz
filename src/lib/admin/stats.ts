// Сводка админки: счётчики и журнал последних действий.
import { getDb, now } from '../db';
import { assertAdmin, type Actor } from './guard';

export type DashboardStats = {
  users: number;
  publishedCourses: number;
  activeEnrollments: number;
  pendingOrders: number;
  certificates: number;
};

export async function getDashboardStats(actor: Actor): Promise<DashboardStats> {
  await assertAdmin(actor);
  const db = await getDb();
  const t = now();
  const [row] = await db.sql<DashboardStats>`
    SELECT (SELECT count(*) FROM users) AS users,
           (SELECT count(*) FROM courses WHERE status = 'published') AS published_courses,
           (SELECT count(*) FROM enrollments
              WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ${t})) AS active_enrollments,
           (SELECT count(*) FROM orders WHERE status = 'pending') AS pending_orders,
           (SELECT count(*) FROM certificates) AS certificates`;
  return row ?? { users: 0, publishedCourses: 0, activeEnrollments: 0, pendingOrders: 0, certificates: 0 };
}

/** Число заказов, ожидающих оплаты (значок в меню админки). */
export async function countPendingOrders(actor: Actor): Promise<number> {
  await assertAdmin(actor);
  const db = await getDb();
  const [row] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM orders WHERE status = 'pending'`;
  return row?.n ?? 0;
}

export type AuditItem = {
  id: string;
  createdAt: number;
  action: string;
  actorName: string | null;
  /** Названия связанных сущностей: из снимка в meta, иначе из БД; '' — неизвестно. */
  course: string;
  user: string;
  title: string;
  number: string;
  /** Новое значение для смены роли. */
  to: string;
};

type AuditRow = {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown> | null;
  createdAt: number;
};

function metaStr(meta: AuditRow['meta'], key: string): string {
  const v = meta?.[key];
  return typeof v === 'string' ? v : '';
}

/** Последние действия. Перестановки порядка (*.move) в ленту не попадают — это шум. */
export async function listRecentAudit(actor: Actor, limit = 12): Promise<AuditItem[]> {
  await assertAdmin(actor);
  const db = await getDb();
  const rows = await db.sql<AuditRow>`
    SELECT id, actor_id, action, entity, entity_id, meta, created_at
    FROM audit_log
    WHERE action NOT LIKE '%.move'
    ORDER BY created_at DESC, id
    LIMIT ${Math.min(Math.max(limit, 1), 100)}`;
  if (rows.length === 0) return [];

  const actorIds = new Set<string>();
  const userIds = new Set<string>();
  const courseIds = new Set<string>();
  const lessonIds = new Set<string>();
  const orderIds = new Set<string>();
  for (const r of rows) {
    if (r.actorId) actorIds.add(r.actorId);
    const mu = metaStr(r.meta, 'userId');
    if (mu) userIds.add(mu);
    if (r.entity === 'user') userIds.add(r.entityId);
    const mc = metaStr(r.meta, 'courseId');
    if (mc) courseIds.add(mc);
    if (r.entity === 'course') courseIds.add(r.entityId);
    if (r.entity === 'lesson') lessonIds.add(r.entityId);
    if (r.entity === 'order') orderIds.add(r.entityId);
  }
  const allUsers = [...new Set([...actorIds, ...userIds])];
  const [users, courses, lessons, orders] = await Promise.all([
    allUsers.length
      ? db.sql<{ id: string; name: string }>`SELECT id, name FROM users WHERE id = ANY(${allUsers})`
      : Promise.resolve([]),
    courseIds.size
      ? db.sql<{ id: string; title: Record<string, string> }>`SELECT id, title FROM courses WHERE id = ANY(${[...courseIds]})`
      : Promise.resolve([]),
    lessonIds.size
      ? db.sql<{ id: string; title: Record<string, string> }>`SELECT id, title FROM lessons WHERE id = ANY(${[...lessonIds]})`
      : Promise.resolve([]),
    orderIds.size
      ? db.sql<{ id: string; number: string }>`SELECT id, number FROM orders WHERE id = ANY(${[...orderIds]})`
      : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const courseTitle = new Map(courses.map((c) => [c.id, c.title.ru ?? '']));
  const lessonTitle = new Map(lessons.map((l) => [l.id, l.title.ru ?? '']));
  const orderNumber = new Map(orders.map((o) => [o.id, o.number]));

  return rows.map((r): AuditItem => {
    const metaCourseId = metaStr(r.meta, 'courseId');
    const metaUserId = metaStr(r.meta, 'userId');
    // курс: актуальное название из БД, иначе снимок из meta (курс могли удалить)
    const courseKey = metaCourseId || (r.entity === 'course' ? r.entityId : '');
    const course = courseTitle.get(courseKey) || (r.entity === 'course' ? metaStr(r.meta, 'title') : '');
    const user = userName.get(metaUserId || (r.entity === 'user' ? r.entityId : '')) || metaStr(r.meta, 'name');
    const title =
      metaStr(r.meta, 'title') ||
      (r.entity === 'lesson' ? (lessonTitle.get(r.entityId) ?? '') : '') ||
      (r.entity === 'course' ? course : '');
    const number =
      metaStr(r.meta, 'number') ||
      metaStr(r.meta, 'orderNumber') ||
      (r.entity === 'order' ? (orderNumber.get(r.entityId) ?? '') : '');
    return {
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      actorName: r.actorId ? (userName.get(r.actorId) ?? null) : null,
      course,
      user,
      title,
      number,
      to: metaStr(r.meta, 'to'),
    };
  });
}
