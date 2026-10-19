// Лимиты оформления заказов (защита от спама). Чистая функция над rateLimit — проверяется unit-тестами.
// Порядок важен: сначала лимит на аккаунт, и только если он пропустил — ведро IP. Иначе спам с
// одного аккаунта расходовал бы ведро IP соседей (общий NAT, офис), не продвигаясь сам.
import { UNKNOWN_IP } from '../auth/clientIp';
import { rateLimit } from '../auth/rateLimit';

export const ORDER_LIMITS = {
  /** На аккаунт: покупатель всегда вошёл (D-020), это основной лимит. */
  perUser: { limit: 10, windowMs: 60 * 60_000 },
  /** На известный IP клиента (доверенная схема, D-018): много аккаунтов с одного адреса. */
  perIp: { limit: 20, windowMs: 60 * 60_000 },
} as const;

/**
 * Можно ли оформить заказ. IP неизвестен (нет доверенного прокси) — общего ведра нет: один
 * скрипт не должен блокировать покупки всем. Аккаунт защищает лимит на него.
 */
export function orderAllowed(userId: string, ip: string, nowMs = Date.now()): boolean {
  const { perUser, perIp } = ORDER_LIMITS;
  if (!rateLimit(`order:user:${userId}`, perUser.limit, perUser.windowMs, nowMs).ok) return false;
  if (ip === UNKNOWN_IP) return true;
  return rateLimit(`order:ip:${ip}`, perIp.limit, perIp.windowMs, nowMs).ok;
}
