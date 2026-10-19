// Лимиты публичной проверки сертификатов. Чистая функция над rateLimit — проверяется unit-тестами.
import { UNKNOWN_IP } from '../auth/clientIp';
import { rateLimit } from '../auth/rateLimit';

export const CERT_LIMITS = {
  /** На IP клиента (доверенная схема, D-018). */
  perIp: { limit: 30, windowMs: 60_000 },
  /**
   * IP неизвестен (нет доверенного прокси) — на номер сертификата вместо общего ведра: скрипт,
   * перебирающий номера, не блокирует проверку всем остальным. Остаточный риск — BUILD.md §5.
   */
  perNumber: { limit: 20, windowMs: 60_000 },
} as const;

/** Ключ номера: регистр и пробелы не важны; длина ограничена, чтобы ключи не раздували память. */
function numberKey(number: string): string {
  return number.trim().toUpperCase().slice(0, 40);
}

/** scope — страница или форма поиска (отдельные счётчики). */
export function certCheckAllowed(scope: string, ip: string, number: string, nowMs = Date.now()): boolean {
  if (ip === UNKNOWN_IP) {
    const l = CERT_LIMITS.perNumber;
    return rateLimit(`${scope}:num:${numberKey(number)}`, l.limit, l.windowMs, nowMs).ok;
  }
  const l = CERT_LIMITS.perIp;
  return rateLimit(`${scope}:ip:${ip}`, l.limit, l.windowMs, nowMs).ok;
}
