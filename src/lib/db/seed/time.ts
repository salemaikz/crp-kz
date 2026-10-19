// Время сида: всё отсчитывается от базы — начала текущих суток (UTC).

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

/** База сида: now, округлённое вниз до суток. */
export function seedBase(nowMs: number): number {
  return Math.floor(nowMs / DAY) * DAY;
}
