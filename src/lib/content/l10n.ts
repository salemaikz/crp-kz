// Чтение локализованных полей {ru, kz}. Нормативно: docs/lms/BUILD.md §3, D-002.
import type { Locale } from './types';

type L10nLike = Partial<Record<string, unknown>> | string | null | undefined;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Значение для локали: нужная → ru → первая непустая → ''. */
export function t(value: L10nLike, locale: Locale | string): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  const own = str(value[locale]);
  if (own) return value[locale] as string;
  const ru = str(value.ru);
  if (ru) return value.ru as string;
  for (const v of Object.values(value)) if (str(v)) return v as string;
  return '';
}

/** Есть ли собственный (не запасной) перевод для локали — для пометки «показано на русском». */
export function hasLocale(value: L10nLike, locale: Locale | string): boolean {
  if (value == null || typeof value === 'string') return locale === 'ru';
  return str(value[locale]) !== '';
}

/** ISO-код языка для <html lang>, hreflang и Intl: kz → kk (D-002). */
export function htmlLang(locale: Locale | string): 'ru' | 'kk' {
  return locale === 'kz' ? 'kk' : 'ru';
}
