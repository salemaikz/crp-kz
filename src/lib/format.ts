// Форматирование чисел, денег, дат и сроков для интерфейса.
// Сегмент URL — ru | kz, но для Intl нужен ISO-код языка: kz → kk (D-002).
import type { Locale } from '@/lib/content/types';

export const TIME_ZONE = 'Asia/Almaty';

const INTL_LOCALE: Record<Locale, string> = { ru: 'ru-RU', kz: 'kk-KZ' };

/** Locale платформы → BCP 47 для Intl. */
export function intlLocale(locale: Locale | string): string {
  return INTL_LOCALE[locale as Locale] ?? INTL_LOCALE.ru;
}

// Узкий неразрывный пробел между разрядами и неразрывный — перед знаком валюты.
const THIN = ' ';
const NBSP = ' ';
const DAY_MS = 86_400_000;

/** 99000 → «99 000 ₸» (разряды — узкий неразрывный пробел). 0 → «0 ₸»: «Бесплатно» решает <Price>. */
export function formatPrice(kzt: number, locale?: Locale | string): string {
  void locale; // формат одинаков для ru и kz
  const sign = kzt < 0 ? '−' : '';
  const digits = String(Math.round(Math.abs(kzt)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return `${sign}${grouped}${NBSP}₸`;
}

/** Целое число с разрядами по правилам локали. */
export function formatNumber(value: number, locale: Locale | string): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(value);
}

type DateOptions = {
  withTime?: boolean;
  short?: boolean;
  /** Не писать год, если дата в текущем году (по Астане): «24 окт.» вместо «24 окт. 2026 г.». */
  omitCurrentYear?: boolean;
  /** «Сейчас» для omitCurrentYear (в тестах). */
  now?: number;
};

/** Календарный год даты в часовом поясе Астаны. */
function almatyYear(ms: number): number {
  const part = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'year');
  return Number(part?.value);
}

/** epoch-мс → «19 октября 2026 г.» в часовом поясе Астаны. */
export function formatDate(ms: number, locale: Locale | string, options: DateOptions = {}): string {
  const omitYear = options.omitCurrentYear === true && almatyYear(ms) === almatyYear(options.now ?? Date.now());
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: options.short ? 'short' : 'long',
    ...(omitYear ? {} : { year: 'numeric' as const }),
    ...(options.withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
  return fmt.format(new Date(ms));
}

/** Минуты → «45 мин», «2 ч», «1 ч 30 мин» (единицы — из данных Intl для локали). */
export function formatDuration(min: number, locale: Locale | string): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const loc = intlLocale(locale);
  const unit = (value: number, u: 'hour' | 'minute') =>
    new Intl.NumberFormat(loc, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value);
  if (h === 0) return unit(m, 'minute');
  if (m === 0) return unit(h, 'hour');
  return `${unit(h, 'hour')} ${unit(m, 'minute')}`;
}

/** Начало календарного дня в Астане (для сравнения сроков «по дням»). */
function almatyDayIndex(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.round(Date.UTC(get('year'), get('month') - 1, get('day')) / DAY_MS);
}

/** Сколько календарных дней до срока (отрицательно — просрочено). */
export function daysUntil(ms: number, now: number = Date.now()): number {
  return almatyDayIndex(ms) - almatyDayIndex(now);
}

export type DueStatus = 'overdue' | 'today' | 'soon' | 'ok';

/** Статус срока: просрочен / сегодня / скоро (≤ 3 дней) / ок. */
export function dueStatus(ms: number, now: number = Date.now()): DueStatus {
  const d = daysUntil(ms, now);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 3) return 'soon';
  return 'ok';
}

/** Срок относительно сегодня: «сегодня», «завтра», «через 5 дней», «3 дня назад». */
export function relativeDue(ms: number, locale: Locale | string, now: number = Date.now()): string {
  const d = daysUntil(ms, now);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  if (Math.abs(d) >= 60) return rtf.format(Math.round(d / 30), 'month');
  if (Math.abs(d) >= 14) return rtf.format(Math.round(d / 7), 'week');
  return rtf.format(d, 'day');
}
