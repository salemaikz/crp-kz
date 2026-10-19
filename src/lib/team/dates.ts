// Срок сдачи: поле <input type="date"> → конец выбранного дня в Астане.
import { TeamError } from './types';

/**
 * «2026-10-25» → 25 октября, 23:59:59 по Астане (UTC+5: Казахстан живёт по единому времени
 * без перехода). Пустая строка — срока нет. Прошедший день — ошибка due_past.
 */
export function parseDueDate(input: string | null | undefined, nowMs: number = Date.now()): number | null {
  const v = (input ?? '').trim();
  if (v === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) throw new TeamError('invalid_input');
  const [, y, mo, d] = m;
  const ms = Date.parse(`${y}-${mo}-${d}T23:59:59+05:00`);
  if (Number.isNaN(ms)) throw new TeamError('invalid_input');
  // 31 февраля и подобное Date.parse «исправляет» молча — сверяем день обратно
  const check = new Date(ms + 5 * 3_600_000);
  if (check.getUTCDate() !== Number(d) || check.getUTCMonth() + 1 !== Number(mo)) throw new TeamError('invalid_input');
  if (ms <= nowMs) throw new TeamError('due_past');
  return ms;
}
