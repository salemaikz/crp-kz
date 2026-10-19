// Общие помощники страниц админки (не маршрут: имя файла не page/layout).
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { requireAdmin, type User } from '@/lib/auth';
import type { Locale } from '@/lib/content/types';
import { routing } from '@/lib/i18n/routing';

/**
 * Локаль из params + проверка администратора. Вызывать в КАЖДОЙ странице админки:
 * проверка в layout не защищает страницу при клиентской навигации.
 */
export async function adminPage(
  params: Promise<{ locale: string }>,
  /** Путь страницы без локали: гость после входа вернётся на неё. */
  path?: string,
): Promise<{ locale: Locale; user: User }> {
  const { locale: raw } = await params;
  const locale: Locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const user = await requireAdmin(locale, path ? `/${locale}${path}` : undefined);
  return { locale, user };
}

/** Страница из ?page=: целое ≥ 1. */
export function pageNumber(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Одиночное значение query-параметра. */
export function one(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
}
