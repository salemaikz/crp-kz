// Номер заказа: CRP-<ГГММДД>-<4 цифры> по дате Астаны. С DEMO-xxxx из сида не пересекается по префиксу.
import { randomInt } from 'node:crypto';

const TIME_ZONE = 'Asia/Almaty';

/** «CRP-261019-» для момента nowMs (календарная дата в Астане). */
export function orderNumberPrefix(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `CRP-${get('year')}${get('month')}${get('day')}-`;
}

export function formatOrderNumber(nowMs: number, digits: number): string {
  return `${orderNumberPrefix(nowMs)}${String(digits % 10_000).padStart(4, '0')}`;
}

/** Случайные 4 цифры (криптостойко: номер не должен быть предсказуемым). */
export function randomOrderDigits(): number {
  return randomInt(0, 10_000);
}

/** Похоже ли значение на номер заказа (наш или из демо-сида) — до запроса в БД. */
export function isOrderNumber(value: string): boolean {
  return /^(CRP-\d{6}-\d{4}|DEMO-\d{4})$/.test(value);
}
