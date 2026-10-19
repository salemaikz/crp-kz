// Пользователи в админке: список с поиском, карточка, выдача и отзыв доступа, смена роли.
import { enroll, revokeEnrollment, type Enrollment, type EnrollmentSource } from '../access';
import { getDb, now } from '../db';
import type { L10n } from '../content/types';
import { writeAudit } from './audit';
import { escapeLike } from './courses';
import { AdminError } from './errors';
import { assertAdmin, type Actor } from './guard';
import { grantSchema, parseOrThrow, roleSchema, USER_ROLES } from './schemas';

export type UserRole = (typeof USER_ROLES)[number];

export type UserListItem = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: number;
  enrollmentsActive: number;
  organizations: Array<{ name: string; role: 'manager' | 'member' }>;
};

export type UserList = { rows: UserListItem[]; total: number; page: number; pageSize: number };

export async function listUsers(
  actor: Actor,
  opts: { q?: string; role?: UserRole; page?: number; pageSize?: number } = {},
): Promise<UserList> {
  await assertAdmin(actor);
  const db = await getDb();
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim() ? `%${escapeLike(opts.q.trim())}%` : null;
  const role = opts.role && USER_ROLES.includes(opts.role) ? opts.role : null;
  const t = now();

  const [count] = await db.sql<{ n: number }>`
    SELECT count(*) AS n FROM users u
    WHERE (${q}::text IS NULL OR u.email ILIKE ${q} OR u.name ILIKE ${q})
      AND (${role}::text IS NULL OR u.role = ${role})`;

  const rows = await db.sql<Omit<UserListItem, 'organizations'>>`
    SELECT u.id, u.email, u.name, u.role, u.created_at,
           (SELECT count(*) FROM enrollments e
              WHERE e.user_id = u.id AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at > ${t})
           ) AS enrollments_active
    FROM users u
    WHERE (${q}::text IS NULL OR u.email ILIKE ${q} OR u.name ILIKE ${q})
      AND (${role}::text IS NULL OR u.role = ${role})
    ORDER BY u.created_at DESC, u.id
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const ids = rows.map((r) => r.id);
  const memberships =
    ids.length === 0
      ? []
      : await db.sql<{ userId: string; name: string; role: 'manager' | 'member' }>`
          SELECT m.user_id, o.name, m.role
          FROM organization_members m JOIN organizations o ON o.id = m.org_id
          WHERE m.user_id = ANY(${ids})
          ORDER BY (o.kind = 'owner') DESC, o.name`;

  return {
    rows: rows.map((r) => ({
      ...r,
      organizations: memberships.filter((m) => m.userId === r.id).map((m) => ({ name: m.name, role: m.role })),
    })),
    total: count?.n ?? 0,
    page,
    pageSize,
  };
}

export type EnrollmentState = 'active' | 'expired' | 'revoked';

export type UserEnrollment = {
  id: string;
  courseId: string;
  courseTitle: L10n;
  courseSlug: string;
  source: EnrollmentSource;
  orgName: string | null;
  grantedByName: string | null;
  dueAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  state: EnrollmentState;
};

export type UserDetail = {
  user: { id: string; email: string; name: string; role: UserRole; locale: 'ru' | 'kz'; createdAt: number; emailVerifiedAt: number | null };
  memberships: Array<{ orgId: string; orgName: string; role: 'manager' | 'member'; position: string | null }>;
  enrollments: UserEnrollment[];
};

function stateOf(e: { revokedAt: number | null; expiresAt: number | null }, t: number): EnrollmentState {
  if (e.revokedAt !== null) return 'revoked';
  if (e.expiresAt !== null && e.expiresAt <= t) return 'expired';
  return 'active';
}

export async function getUserDetail(actor: Actor, userId: string): Promise<UserDetail | null> {
  await assertAdmin(actor);
  const db = await getDb();
  const [user] = await db.sql<UserDetail['user']>`
    SELECT id, email, name, role, locale, created_at, email_verified_at FROM users WHERE id = ${userId}`;
  if (!user) return null;
  const memberships = await db.sql<UserDetail['memberships'][number]>`
    SELECT m.org_id, o.name AS org_name, m.role, m.position
    FROM organization_members m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ${userId}
    ORDER BY (o.kind = 'owner') DESC, o.name`;
  const t = now();
  const rows = await db.sql<Omit<UserEnrollment, 'state'>>`
    SELECT e.id, e.course_id, c.title AS course_title, c.slug AS course_slug, e.source,
           org.name AS org_name, g.name AS granted_by_name, e.due_at, e.expires_at, e.revoked_at, e.created_at
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    LEFT JOIN organizations org ON org.id = e.org_id
    LEFT JOIN users g ON g.id = e.granted_by
    WHERE e.user_id = ${userId}
    ORDER BY e.created_at DESC, e.id`;
  return { user, memberships, enrollments: rows.map((r) => ({ ...r, state: stateOf(r, t) })) };
}

/** Выдать доступ вручную (source 'grant'). Повторная выдача возобновляет отозванный или истёкший доступ. */
export async function grantAccess(actor: Actor, raw: unknown): Promise<Enrollment> {
  await assertAdmin(actor);
  const input = parseOrThrow(grantSchema, raw);
  const db = await getDb();
  const [u] = await db.sql`SELECT 1 FROM users WHERE id = ${input.userId}`;
  if (!u) throw new AdminError('NOT_FOUND', { userId: 'invalid' });
  const [c] = await db.sql`SELECT 1 FROM courses WHERE id = ${input.courseId}`;
  if (!c) throw new AdminError('NOT_FOUND', { courseId: 'invalid' });
  // enroll сам пишет enrollment.grant в audit_log (с grantedBy = актор)
  return enroll({
    userId: input.userId,
    courseId: input.courseId,
    source: 'grant',
    grantedBy: actor.id,
    accessDays: input.accessDays,
  });
}

/** Отозвать доступ (любой источник). Прогресс и сертификаты сохраняются. */
export async function revokeAccess(actor: Actor, userId: string, courseId: string): Promise<void> {
  await assertAdmin(actor);
  const db = await getDb();
  const [e] = await db.sql`SELECT 1 FROM enrollments WHERE user_id = ${userId} AND course_id = ${courseId}`;
  if (!e) throw new AdminError('NOT_FOUND');
  // revokeEnrollment сам пишет enrollment.revoke в audit_log
  await revokeEnrollment(userId, courseId, actor.id);
}

/** Смена роли. Свою роль менять нельзя — так в системе всегда остаётся хотя бы один администратор. */
export async function changeRole(actor: Actor, raw: unknown): Promise<void> {
  await assertAdmin(actor);
  const input = parseOrThrow(roleSchema, raw);
  if (input.userId === actor.id) throw new AdminError('CANNOT_CHANGE_SELF');
  const db = await getDb();
  await db.tx(async (sql) => {
    const [u] = await sql<{ role: UserRole; name: string }>`SELECT role, name FROM users WHERE id = ${input.userId} FOR UPDATE`;
    if (!u) throw new AdminError('NOT_FOUND');
    if (u.role === input.role) return;
    await sql`UPDATE users SET role = ${input.role} WHERE id = ${input.userId}`;
    await writeAudit(sql, actor.id, 'user.role_change', 'user', input.userId, {
      userId: input.userId,
      name: u.name,
      from: u.role,
      to: input.role,
    });
  });
}
