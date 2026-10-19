// Доступ к курсам — единственный источник правды. Нормативно: docs/lms/BUILD.md §4, SPEC.md §2.
// Доступ к урокам — только по действующему зачислению (не отозвано, не истекло).
import { writeAudit } from './audit';
import { getDb, newId, now, type Sql } from './db';

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
  /**
   * Точный момент окончания доступа (epoch-мс, null — бессрочно) вместо accessDays.
   * Для перепривязки доступа к ранее оплаченному заказу при возврате: срок того заказа
   * считается от его оплаты, а не от «сейчас». Должен быть в будущем.
   */
  expiresAt?: number | null;
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
 * опубликованный бесплатный public или опубликованный internal организации, где пользователь
 * состоит. Бесплатный = у курса нет offer или его price_kzt = 0. Offer с ценой > 0 запрещает
 * self независимо от active: «пауза продаж» не делает платный курс бесплатным.
 * Поля курса берутся из БД, а не из аргумента — их нельзя подменить.
 */
export async function canSelfEnroll(userId: string, course: CourseForEnroll, sql?: Sql): Promise<boolean> {
  const s = await q(sql);
  const [c] = await s<{ visibility: string; ownerOrgId: string | null; status: string }>`
    SELECT visibility, owner_org_id, status FROM courses WHERE id = ${course.id}`;
  if (!c || c.status !== 'published') return false;
  // платный курс (любой offer с ценой > 0, активный или нет) никогда не даёт self
  const paid = await s`SELECT 1 FROM course_offers WHERE course_id = ${course.id} AND price_kzt > 0`;
  if (paid.length > 0) return false;
  if (c.visibility === 'public') return true;
  if (c.visibility === 'internal' && c.ownerOrgId) {
    const rows = await s`
      SELECT 1 FROM organization_members WHERE user_id = ${userId} AND org_id = ${c.ownerOrgId}`;
    return rows.length > 0;
  }
  return false;
}

/**
 * Срок нового зачисления поверх существующей строки (повтор того же заказа сюда не доходит —
 * enroll возвращает строку без изменений раньше).
 * - Действующее зачисление: новый срок не сокращает текущий — берём max(текущий, новый),
 *   бессрочный (null) длиннее любого. Так покупка/выдача продлевают доступ, а назначение
 *   или self не обрезают уже купленный более длинный доступ.
 * - Отозванное или истёкшее: прежний срок не в счёт, действует только новый (от «сейчас»).
 */
function mergeExpiry(cur: Enrollment, next: number | null, nowMs: number): number | null {
  if (!enrollmentState(cur, nowMs).ok) return next;
  if (cur.expiresAt === null || next === null) return null;
  return Math.max(cur.expiresAt, next);
}

/** accessDays: только целое > 0 либо null/undefined (бессрочно). Иначе RangeError. */
function expiryFor(accessDays: number | null | undefined, nowMs: number): number | null {
  if (accessDays === null || accessDays === undefined) return null;
  const expiresAt = nowMs + accessDays * DAY_MS;
  if (!Number.isInteger(accessDays) || accessDays <= 0 || !Number.isSafeInteger(expiresAt)) {
    throw new RangeError(`accessDays must be a positive integer or null, got ${String(accessDays)}`);
  }
  return expiresAt;
}

async function audit(sql: Sql, actorId: string | null, action: 'enrollment.grant' | 'enrollment.revoke', entityId: string, meta: Record<string, unknown>) {
  await writeAudit(sql, { actorId, action, entity: 'enrollment', entityId, meta });
}

/** Срок новой выдачи: явный expiresAt (если передан) или от accessDays. */
function expiryOf(input: EnrollInput, nowMs: number): number | null {
  if (input.expiresAt !== undefined) {
    const e = input.expiresAt;
    if (e !== null && (!Number.isSafeInteger(e) || e <= nowMs)) {
      throw new RangeError(`expiresAt must be a future epoch-ms integer or null, got ${String(e)}`);
    }
    return e;
  }
  return expiryFor(input.accessDays, nowMs);
}

/**
 * Зачислить пользователя (upsert по (user_id, course_id)).
 * - Повтор того же заказа (input.orderId совпадает с order_id строки) — no-op в любом
 *   состоянии: строка возвращается как есть, отзыв не снимается, срок не продлевается
 *   (повторная доставка «оплачено» после возврата не возвращает доступ).
 * - Иначе это новая выдача: снимает revoked, source/org/order/grantedBy/due берутся из input
 *   (не переданы — null, без «хвостов» прежнего источника), срок — см. mergeExpiry.
 * - accessDays — целое > 0 или null/не задан (бессрочно); иначе RangeError. expiresAt — точный
 *   конец срока вместо accessDays (в будущем или null).
 * Пишет enrollment.grant в audit_log, когда состояние изменилось.
 * source 'self' разрешён только при canSelfEnroll — иначе ошибка SELF_ENROLL_FORBIDDEN.
 */
export async function enroll(input: EnrollInput, sql?: Sql): Promise<Enrollment> {
  expiryOf(input, now()); // RangeError до любых запросов
  const run = async (s: Sql): Promise<Enrollment> => {
    // защита в глубину: self только там, где его разрешает canSelfEnroll (платный — никогда)
    if (input.source === 'self' && !(await canSelfEnroll(input.userId, { id: input.courseId }, s))) {
      throw new Error('SELF_ENROLL_FORBIDDEN');
    }
    const t = now();
    const expiresAt = expiryOf(input, t);
    // срок в журнале — так, как его задали: явный expiresAt (переход доступа на другой заказ)
    // пишем им самим, иначе accessDays: null читался бы как «бессрочно»
    const meta = {
      source: input.source,
      courseId: input.courseId,
      userId: input.userId,
      orderId: input.orderId ?? null,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : { accessDays: input.accessDays ?? null }),
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
    // повтор того же заказа — ничего не меняем ни в каком состоянии (идемпотентность оплаты)
    if (input.orderId && input.orderId === cur.orderId) return cur;
    // новая выдача заменяет источник целиком: привязки прежнего источника не переносятся
    const next = {
      source: input.source,
      orgId: input.orgId ?? null,
      orderId: input.orderId ?? null,
      grantedBy: input.grantedBy ?? null,
      dueAt: input.dueAt ?? null,
      expiresAt: mergeExpiry(cur, expiresAt, t),
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

/** Необязательный фильтр отзыва: отзывать, только если доступ всё ещё держится на этом источнике. */
export type RevokeFilter = {
  /** Отозвать, только если enrollments.order_id = orderId (возврат заказа A не трогает доступ по заказу B). */
  orderId?: string;
  /** Отозвать, только если org_id = orgId и source IN ('assignment','self','seat') (уход из организации). */
  orgId?: string;
};

/**
 * Отозвать доступ (идемпотентно). Прогресс и сертификаты сохраняются.
 * opts — фильтр по источнику (см. RevokeFilter); без него отзывается любое действующее зачисление.
 * Условие фильтра проверяется внутри UPDATE (без гонки «прочитал — отозвал»).
 * Возвращает true, если доступ был отозван этим вызовом.
 */
export async function revokeEnrollment(
  userId: string,
  courseId: string,
  actorId: string | null,
  sql?: Sql,
  opts: RevokeFilter = {},
): Promise<boolean> {
  const orderId = opts.orderId ?? null;
  const orgId = opts.orgId ?? null;
  const run = async (s: Sql) => {
    const t = now();
    const [row] = await s<{ id: string; source: string }>`
      UPDATE enrollments SET revoked_at = ${t}, updated_at = ${t}
      WHERE user_id = ${userId} AND course_id = ${courseId} AND revoked_at IS NULL
        AND (${orderId}::text IS NULL OR order_id = ${orderId})
        AND (${orgId}::text IS NULL OR (org_id = ${orgId} AND source IN ('assignment', 'self', 'seat')))
      RETURNING id, source`;
    if (row) {
      await audit(s, actorId, 'enrollment.revoke', row.id, {
        userId,
        courseId,
        source: row.source,
        ...(orderId ? { orderId } : {}),
        ...(orgId ? { orgId } : {}),
      });
    }
    return Boolean(row);
  };
  if (sql) return run(sql);
  return (await getDb()).tx(run);
}
