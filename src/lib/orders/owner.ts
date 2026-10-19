// Действия покупателя над своим заказом. Сейчас одно: отменить свой неоплаченный заказ, чтобы
// оформить новый (например, со счётом на компанию вместо Kaspi) — второй открытый не создаётся (D-020).
import { getDb, now } from '../db';
import { audit } from './admin';
import type { Order, OrderDecision, OrderStatus } from './types';

/**
 * pending → cancelled по просьбе владельца. Только свой заказ (user_id = userId) и только из
 * pending — условие внутри UPDATE: оплаченный за это время заказ не отменится. Чужой или
 * несуществующий заказ — not_found (не раскрываем, что он есть). Журнал: order.cancel_by_owner.
 */
export async function cancelOwnOrder(orderId: string, userId: string): Promise<OrderDecision> {
  if (typeof userId !== 'string' || userId === '') return { ok: false, reason: 'not_found' };
  const db = await getDb();
  return db.tx(async (sql) => {
    const t = now();
    const [o] = await sql<Order>`
      UPDATE orders SET status = 'cancelled', decided_by = ${userId}, updated_at = ${t}
      WHERE id = ${orderId} AND user_id = ${userId} AND status = 'pending'
      RETURNING *`;
    if (!o) {
      const [cur] = await sql<{ status: OrderStatus }>`
        SELECT status FROM orders WHERE id = ${orderId} AND user_id = ${userId}`;
      if (!cur) return { ok: false, reason: 'not_found' };
      return { ok: false, reason: cur.status === 'paid' ? 'already_paid' : 'not_pending', status: cur.status };
    }
    await audit(sql, db.json, userId, 'order.cancel_by_owner', o.id, { number: o.number, amountKzt: o.amountKzt });
    return { ok: true, order: o, userId };
  });
}
