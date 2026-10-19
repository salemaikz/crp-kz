// Приватный доступ к заказу без входа: ключ = HMAC-SHA256(SESSION_SECRET, id заказа).
// Ключ не хранится в БД (миграции не меняем): его можно вычислить только зная секрет.
// Смотреть заказ могут: владелец (users.id = orders.user_id), администратор, держатель ключа.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from '../env';

/** Разделение доменов: этим секретом подписываются и сессии. */
const DOMAIN = 'crp:order-access:v1:';
const KEY_LENGTH = 32; // символов base64url ≈ 192 бита

export function orderAccessKey(orderId: string): string {
  return createHmac('sha256', sessionSecret())
    .update(DOMAIN + orderId)
    .digest('base64url')
    .slice(0, KEY_LENGTH);
}

/** Сравнение за постоянное время; любой мусор на входе — false. */
export function verifyOrderAccessKey(orderId: string, key: unknown): boolean {
  if (typeof key !== 'string' || key.length !== KEY_LENGTH) return false;
  const expected = Buffer.from(orderAccessKey(orderId));
  const given = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type OrderViewer = { id: string; role: string } | null;

/** Может ли зритель открыть заказ: администратор, владелец или верный ключ. */
export function canViewOrder(
  order: { id: string; userId: string | null },
  viewer: OrderViewer,
  key?: unknown,
): boolean {
  if (viewer?.role === 'admin') return true;
  if (viewer && order.userId && viewer.id === order.userId) return true;
  return verifyOrderAccessKey(order.id, key);
}
