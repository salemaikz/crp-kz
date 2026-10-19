// Решения администратора по заказу: «Оплачено», «Отменить», «Возврат». Каждое — одна транзакция.
// Переход статуса — условный UPDATE … WHERE status = <ожидаемый> RETURNING: двойной клик и
// параллельные вызовы не создают дублей (второй получит отказ), возвращённый заказ не оплатить.
import { DAY_MS, enroll, revokeEnrollment } from '../access';
import { writeAudit } from '../audit';
import { getDb, now, type Sql } from '../db';
import type { Order, OrderDecision, OrderStatus } from './types';

type Op = 'paid' | 'cancel' | 'refund';

/** Запись order.* в журнал (без ПДн покупателя). */
export async function audit(
  sql: Sql,
  actorId: string,
  action: 'order.paid' | 'order.cancel' | 'order.refund' | 'order.cancel_by_owner',
  entityId: string,
  meta: Record<string, unknown>,
) {
  await writeAudit(sql, { actorId, action, entity: 'order', entityId, meta });
}

/** Почему переход не состоялся: заказа нет, статус уже другой или у заказа нет покупателя. */
async function refusal(sql: Sql, orderId: string, op: Op): Promise<OrderDecision> {
  const [cur] = await sql<{ status: OrderStatus; userId: string | null }>`
    SELECT status, user_id FROM orders WHERE id = ${orderId}`;
  if (!cur) return { ok: false, reason: 'not_found' };
  if (op === 'refund') return { ok: false, reason: 'not_paid', status: cur.status };
  if (cur.status === 'paid') return { ok: false, reason: 'already_paid', status: cur.status };
  if (op === 'paid' && cur.status === 'pending' && !cur.userId) {
    return { ok: false, reason: 'no_user', status: cur.status };
  }
  return { ok: false, reason: 'not_pending', status: cur.status };
}

/**
 * pending → paid. В одной транзакции: статус (только из pending и только при заданном
 * order.user_id) → зачисление purchase владельцу заказа со сроком, зафиксированным в заказе →
 * audit order.paid. Пользователей не ищет по email и не создаёт (D-020): заказ без аккаунта
 * (аккаунт удалён) — отказ no_user.
 */
export async function markPaid(orderId: string, adminId: string): Promise<OrderDecision> {
  const db = await getDb();
  return db.tx(async (sql) => {
    const t = now();
    const [o] = await sql<Order>`
      UPDATE orders SET status = 'paid', paid_at = ${t}, decided_by = ${adminId}, updated_at = ${t}
      WHERE id = ${orderId} AND status = 'pending' AND user_id IS NOT NULL
      RETURNING *`;
    if (!o) return refusal(sql, orderId, 'paid');
    const userId = o.userId as string;

    const enrollment = await enroll(
      {
        userId,
        courseId: o.courseId,
        source: 'purchase',
        orderId: o.id,
        grantedBy: adminId,
        accessDays: o.accessDays,
      },
      sql,
    );
    await audit(sql, adminId, 'order.paid', o.id, {
      number: o.number,
      amountKzt: o.amountKzt,
      accessDays: o.accessDays,
      userId,
      enrollmentId: enrollment.id,
    });
    return { ok: true, order: o, userId };
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
    await audit(sql, adminId, 'order.cancel', o.id, { number: o.number, amountKzt: o.amountKzt });
    return { ok: true, order: o };
  });
}

/** Конец доступа по оплаченному заказу: от оплаты + срок заказа; null — бессрочно. */
function orderExpiry(o: Pick<Order, 'paidAt' | 'accessDays'>): number | null {
  if (o.accessDays === null) return null;
  return (o.paidAt ?? 0) + o.accessDays * DAY_MS;
}

/**
 * paid → refunded. Доступ снимается, только если держится на этом заказе: фильтр orderId
 * проверяется внутри UPDATE (revokeEnrollment), без гонки «прочитал — отозвал». Доступ по другому
 * заказу, назначению или выдаче админом не трогаем.
 * Если у покупателя есть другой оплаченный заказ на курс, срок которого ещё идёт, доступ
 * переходит на него (D-020): order_id — тот заказ, срок — от его оплаты (не продлевается).
 * Возвращаемый заказ блокирует условный UPDATE, кандидаты на перенос — SELECT … FOR UPDATE:
 * параллельные возвраты двух заказов одного покупателя не переносят доступ на возвращённый.
 * Прогресс и сертификаты сохраняются.
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
    let accessMovedTo: string | undefined;
    if (o.userId) {
      const revoked = await revokeEnrollment(o.userId, o.courseId, adminId, sql, { orderId: o.id });
      if (revoked) {
        // Кандидаты блокируются (FOR UPDATE): параллельный возврат кандидата ждёт конца этой
        // транзакции, а если он успел первым — после его коммита строка перечитывается и уже не
        // проходит status = 'paid' (READ COMMITTED). Без блокировки два одновременных возврата
        // A и B переносили бы доступ A на уже возвращённый B.
        const others = await sql<Order>`
          SELECT * FROM orders
          WHERE user_id = ${o.userId} AND course_id = ${o.courseId} AND status = 'paid' AND id <> ${o.id}
          ORDER BY id
          FOR UPDATE`;
        // действующий заказ с самым поздним концом срока (бессрочный — дальше любого);
        // остаток меньше минуты не в счёт; статус перепроверяем по заблокированной строке
        const live = others
          .filter((x) => x.status === 'paid')
          .map((x) => ({ order: x, expiresAt: orderExpiry(x) }))
          .filter((x) => x.expiresAt === null || x.expiresAt > t + 60_000)
          .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))
          .at(-1);
        if (live) {
          await enroll(
            {
              userId: o.userId,
              courseId: o.courseId,
              source: 'purchase',
              orderId: live.order.id,
              grantedBy: adminId,
              expiresAt: live.expiresAt,
            },
            sql,
          );
          accessMovedTo = live.order.number;
        } else {
          accessRevoked = true;
        }
      }
    }
    await audit(sql, adminId, 'order.refund', o.id, {
      number: o.number,
      amountKzt: o.amountKzt,
      accessRevoked,
      ...(accessMovedTo ? { accessMovedTo } : {}),
    });
    return { ok: true, order: o, accessRevoked, ...(accessMovedTo ? { accessMovedTo } : {}) };
  });
}
