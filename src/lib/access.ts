// Доступ к курсам — единственный источник правды. Нормативно: docs/lms/BUILD.md §4, SPEC.md §2.
// Доступ к урокам — только по действующему зачислению (не отозвано, не истекло).
import { getDb, newId, now, type Sql } from './db';
import { jsonParam } from './db/core';

export const DAY_MS = 24 * 60 * 60 * 1000;

export type EnrollmentSource = 'purchase' | 'assignment' | 'seat' | 'grant' | 'self';

export type Enrollment = {
  id: string;
  userId: string;
  courseId: string;
  source: EnrollmentSource;
  orgId: string | null;
  orderId: string | null;
  grantedBy: string | null;
  dueAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AccessResult = { ok: boolean; enrollment?: Enrollment; reason?: 'none' | 'expired' | 'revoked' };

/** Курс для canSelfEnroll: нужен только id — видимость, владелец и статус читаются из БД. */
export type CourseForEnroll = { id: string; visibility?: unknown; ownerOrgId?: unknown; status?: unknown };

export type EnrollInput = {
  userId: string;
  courseId: string;
  source: EnrollmentSource;
  orgId?: string | null;
  orderId?: string | null;
  grantedBy?: string | null;
  dueAt?: number | null;
  /** Срок доступа в днях от момента зачисления; null/не задан — бессрочно. */
  accessDays?: number | null;
};

async function q(sql?: Sql): Promise<Sql> {
  return sql ?? (await getDb()).sql;
}

/** Состояние зачисления на момент nowMs. */
export function enrollmentState(e: Enrollment | null | undefined, nowMs = now()): AccessResult {
  if (!e) return { ok: false, reason: 'none' };
  if (e.revokedAt !== null) return { ok: false, enrollment: e, reason: 'revoked' };
  if (e.expiresAt !== null && e.expiresAt <= nowMs) return { ok: false, enrollment: e, reason: 'expired' };
  return { ok: true, enrollment: e };
}

export async function getEnrollment(userId: string, courseId: string, sql?: Sql): Promise<Enrollment | null> {
  const s = await q(sql);
  const [row] = await s<Enrollment>`
    SELECT * FROM enrollments WHERE user_id = ${userId} AND course_id = ${courseId}`;
  return row ?? null;
}

/** Все зачисления пользователя (включая отозванные и истёкшие), новые сверху. */
export async function listEnrollments(userId: string, sql?: Sql): Promise<Enrollment[]> {
  const s = await q(sql);
  return s<Enrollment>`SELECT * FROM enrollments WHERE user_id = ${userId} ORDER BY created_at DESC, id`;
}

/** Есть ли у пользователя действующий доступ к курсу. */
export async function canAccessCourse(userId: string, courseId: string, sql?: Sql): Promise<AccessResult> {
  return enrollmentState(await getEnrollment(userId, courseId, sql));
}

/**
 * Может ли пользователь сам записаться (source 'self'):
 * опубликованный бесплатный public (нет активного offer или цена 0) или опубликованный
 * internal организации, где пользователь состоит. Платный курс никогда не даёт self.
 * Поля курса берутся из БД, а не из аргумента — их нельзя подменить.
 */
export async function canSelfEnroll(userId: string, course: CourseForEnroll, sql?: Sql): Promise<boolean> {
  const s = await q(sql);
  const [c] = await s<{ visibility: string; ownerOrgId: string | null; status: string }>`
    SELECT visibility, owner_org_id, status FROM courses WHERE id = ${course.id}`;
  if (!c || c.status !== 'published') return false;
  if (c.visibility === 'public') {
    const offers = await s<{ priceKzt: number }>`
      SELECT price_kzt FROM course_offers WHERE course_id = ${course.id} AND active = true`;
    return offers.every((o) => o.priceKzt === 0);
  }
  if (c.visibility === 'internal' && c.ownerOrgId) {
    const rows = await s`
      SELECT 1 FROM organization_members WHERE user_id = ${userId} AND org_id = ${c.ownerOrgId}`;
    return rows.length > 0;
  }
  return false;
}

/**
 * Новый срок не сокращает уже действующий: бессрочный (null) длиннее любого.
 * Повтор того же заказа по действующему зачислению срок не меняет (идемпотентность оплаты).
 */
function mergeExpiry(cur: Enrollment, next: number | null, nowMs: number, orderId: string | null): number | null {
  const active = enrollmentState(cur, nowMs).ok;
  if (!active) return next;
  if (orderId && orderId === cur.orderId) return cur.expiresAt;
  if (cur.expiresAt === null || next === null) return null;
  return Math.max(cur.expiresAt, next);
}

async function audit(sql: Sql, actorId: string | null, action: string, entityId: string, meta: object) {
  await sql`
    INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
    VALUES (${newId()}, ${actorId}, ${action}, 'enrollment', ${entityId}, ${jsonParam(meta)}, ${now()})`;
}

/**
 * Зачислить пользователя (идемпотентно, upsert по (user_id, course_id)).
 * Снимает revoked, ставит expires_at по accessDays (не сокращая действующий срок),
 * обновляет source; org/order/grantedBy/due сохраняются, если не переданы.
 * Пишет enrollment.grant в audit_log, когда состояние изменилось.
 * source 'self' разрешён только при canSelfEnroll — иначе ошибка SELF_ENROLL_FORBIDDEN.
 */
export async function enroll(input: EnrollInput, sql?: Sql): Promise<Enrollment> {
  const run = async (s: Sql): Promise<Enrollment> => {
    // защита в глубину: self только там, где его разрешает canSelfEnroll (платный — никогда)
    if (input.source === 'self' && !(await canSelfEnroll(input.userId, { id: input.courseId }, s))) {
      throw new Error('SELF_ENROLL_FORBIDDEN');
    }
    const t = now();
    const expiresAt = input.accessDays ? t + input.accessDays * DAY_MS : null;
    const meta = {
      source: input.source,
      courseId: input.courseId,
      userId: input.userId,
      orderId: input.orderId ?? null,
      accessDays: input.accessDays ?? null,
    };

    const [inserted] = await s<Enrollment>`
      INSERT INTO enrollments (id, user_id, course_id, source, org_id, order_id, granted_by,
                               due_at, expires_at, revoked_at, created_at, updated_at)
      VALUES (${newId()}, ${input.userId}, ${input.courseId}, ${input.source}, ${input.orgId ?? null},
              ${input.orderId ?? null}, ${input.grantedBy ?? null}, ${input.dueAt ?? null}, ${expiresAt},
              NULL, ${t}, ${t})
      ON CONFLICT (user_id, course_id) DO NOTHING
      RETURNING *`;
    if (inserted) {
      await audit(s, input.grantedBy ?? null, 'enrollment.grant', inserted.id, meta);
      return inserted;
    }

    const [cur] = await s<Enrollment>`
      SELECT * FROM enrollments WHERE user_id = ${input.userId} AND course_id = ${input.courseId} FOR UPDATE`;
    if (!cur) throw new Error('enrollment vanished during upsert');
    const next = {
      source: input.source,
      orgId: input.orgId ?? cur.orgId,
      orderId: input.orderId ?? cur.orderId,
      grantedBy: input.grantedBy ?? cur.grantedBy,
      dueAt: input.dueAt ?? cur.dueAt,
      expiresAt: mergeExpiry(cur, expiresAt, t, input.orderId ?? null),
    };
    const changed =
      cur.revokedAt !== null ||
      next.source !== cur.source ||
      next.orgId !== cur.orgId ||
      next.orderId !== cur.orderId ||
      next.grantedBy !== cur.grantedBy ||
      next.dueAt !== cur.dueAt ||
      next.expiresAt !== cur.expiresAt;
    if (!changed) return cur;

    const [updated] = await s<Enrollment>`
      UPDATE enrollments SET
        source = ${next.source}, org_id = ${next.orgId}, order_id = ${next.orderId},
        granted_by = ${next.grantedBy}, due_at = ${next.dueAt}, expires_at = ${next.expiresAt},
        revoked_at = NULL, updated_at = ${t}
      WHERE id = ${cur.id}
      RETURNING *`;
    await audit(s, input.grantedBy ?? null, 'enrollment.grant', cur.id, {
      ...meta,
      reactivated: cur.revokedAt !== null,
    });
    return updated as Enrollment;
  };
  if (sql) return run(sql);
  return (await getDb()).tx(run);
}

/** Отозвать доступ (идемпотентно). Прогресс и сертификаты сохраняются. */
export async function revokeEnrollment(userId: string, courseId: string, actorId: string | null, sql?: Sql): Promise<void> {
  const run = async (s: Sql) => {
    const t = now();
    const [row] = await s<{ id: string; source: string }>`
      UPDATE enrollments SET revoked_at = ${t}, updated_at = ${t}
      WHERE user_id = ${userId} AND course_id = ${courseId} AND revoked_at IS NULL
      RETURNING id, source`;
    if (row) await audit(s, actorId, 'enrollment.revoke', row.id, { userId, courseId, source: row.source });
  };
  if (sql) return run(sql);
  return (await getDb()).tx(run);
}
