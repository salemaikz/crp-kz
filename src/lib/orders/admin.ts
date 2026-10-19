// Решения администратора по заказу: «Оплачено», «Отменить», «Возврат». Каждое — одна транзакция.
// Переход статуса — условный UPDATE … WHERE status = <ожидаемый> RETURNING: двойной клик и
// параллельные вызовы не создают дублей (второй получит отказ), возвращённый заказ не оплатить.
import { enroll, getEnrollment, revokeEnrollment } from '../access';
import { normalizeEmail } from '../auth';
import { getDb, newId, now, type Sql } from '../db';
import type { Order, OrderDecision, OrderStatus } from './types';

type Op = 'paid' | 'cancel' | 'refund';

async function audit(
  sql: Sql,
  json: (v: unknown) => unknown,
  actorId: string,
  action: string,
  entityId: string,
  meta: object,
) {
  await sql`
    INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
    VALUES (${newId()}, ${actorId}, ${action}, 'order', ${entityId}, ${json(meta)}, ${now()})`;
}

/** Почему переход не состоялся: заказа нет или статус уже другой. */
async function refusal(sql: Sql, orderId: string, op: Op): Promise<OrderDecision> {
  const [cur] = await sql<{ status: OrderStatus }>`SELECT status FROM orders WHERE id = ${orderId}`;
  if (!cur) return { ok: false, reason: 'not_found' };
  if (op === 'refund') return { ok: false, reason: 'not_paid', status: cur.status };
  if (cur.status === 'paid') return { ok: false, reason: 'already_paid', status: cur.status };
  return { ok: false, reason: 'not_pending', status: cur.status };
}

/**
 * pending → paid. В одной транзакции: статус (только из pending) → покупатель (владелец заказа,
 * иначе пользователь с этим email, иначе новый аккаунт без пароля) → order.user_id →
 * зачисление purchase со сроком из предложения → audit order.paid.
 */
export async function markPaid(orderId: string, adminId: string): Promise<OrderDecision> {
  const db = await getDb();
  return db.tx(async (sql) => {
    const t = now();
    const [o] = await sql<Order>`
      UPDATE orders SET status = 'paid', paid_at = ${t}, decided_by = ${adminId}, updated_at = ${t}
      WHERE id = ${orderId} AND status = 'pending'
      RETURNING *`;
    if (!o) return refusal(sql, orderId, 'paid');

    let userId: string | null = null;
    let userCreated = false;
    if (o.userId) {
      const [owner] = await sql<{ id: string }>`SELECT id FROM users WHERE id = ${o.userId}`;
      userId = owner?.id ?? null;
    }
    if (!userId) {
      const email = normalizeEmail(o.buyerEmail);
      const [created] = await sql<{ id: string }>`
        INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
        VALUES (${newId()}, ${email}, NULL, ${o.buyerName}, 'learner', 'ru', ${t})
        ON CONFLICT (email) DO NOTHING
        RETURNING id`;
      if (created) {
        userId = created.id;
        userCreated = true;
        await sql`
          INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
          VALUES (${newId()}, ${adminId}, 'user.create_from_order', 'user', ${created.id},
                  ${db.json({ orderId: o.id, number: o.number })}, ${t})`;
      } else {
        const [existing] = await sql<{ id: string }>`SELECT id FROM users WHERE email = ${email}`;
        if (!existing) throw new Error('markPaid: buyer user vanished');
        userId = existing.id;
      }
    }

    await sql`UPDATE orders SET user_id = ${userId} WHERE id = ${o.id}`;
    // срок — из предложения курса на момент оплаты; нет предложения — бессрочно
    const [offer] = await sql<{ accessDays: number | null }>`
      SELECT access_days FROM course_offers WHERE course_id = ${o.courseId}`;
    const enrollment = await enroll(
      {
        userId,
        courseId: o.courseId,
        source: 'purchase',
        orderId: o.id,
        grantedBy: adminId,
        accessDays: offer?.accessDays ?? null,
      },
      sql,
    );
    await audit(sql, db.json, adminId, 'order.paid', o.id, {
      number: o.number,
      amountKzt: o.amountKzt,
      userId,
      userCreated,
      enrollmentId: enrollment.id,
    });
    return { ok: true, order: { ...o, userId }, userId, userCreated };
  });
}

/** pending → cancelled. Доступ не выдавался — зачисления не трогаем. */
export async function cancelOrder(orderId: string, adminId: string): Promise<OrderDecision> {
  const db = await getDb();
  return db.tx(async (sql) => {
    const t = now();
    const [o] = await sql<Order>`
      UPDATE orders SET status = 'cancelled', decided_by = ${adminId}, updated_at = ${t}
      WHERE id = ${orderId} AND status = 'pending'
      RETURNING *`;
    if (!o) return refusal(sql, orderId, 'cancel');
    await audit(sql, db.json, adminId, 'order.cancel', o.id, { number: o.number, amountKzt: o.amountKzt });
    return { ok: true, order: o };
  });
}

/**
 * paid → refunded + отзыв доступа. Отзываем, только если зачисление выдано именно этим заказом
 * (source purchase, order_id = заказ): доступ по другому заказу или выдаче админом не трогаем.
 * Прогресс и сертификаты сохраняются (revokeEnrollment).
 */
export async function refundOrder(orderId: string, adminId: string): Promise<OrderDecision> {
  const db = await getDb();
  return db.tx(async (sql) => {
    const t = now();
    const [o] = await sql<Order>`
      UPDATE orders SET status = 'refunded', decided_by = ${adminId}, updated_at = ${t}
      WHERE id = ${orderId} AND status = 'paid'
      RETURNING *`;
    if (!o) return refusal(sql, orderId, 'refund');
    let accessRevoked = false;
    if (o.userId) {
      const e = await getEnrollment(o.userId, o.courseId, sql);
      if (e && e.source === 'purchase' && e.orderId === o.id && e.revokedAt === null) {
        await revokeEnrollment(o.userId, o.courseId, adminId, sql);
        accessRevoked = true;
      }
    }
    await audit(sql, db.json, adminId, 'order.refund', o.id, {
      number: o.number,
      amountKzt: o.amountKzt,
      accessRevoked,
    });
    return { ok: true, order: o, accessRevoked };
  });
}
