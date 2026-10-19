// Окружение: режим демо, секрет сессии, публичный адрес. Нормативно: docs/lms/BUILD.md §2, §5.

/** Фиксированный секрет для демо (PGlite, без реальных данных). Вне демо не используется. */
const DEMO_SESSION_SECRET = 'crp-demo-session-secret--not-for-production--2026-10-19';
const MIN_SECRET_LENGTH = 32;

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Демо-режим: нет DATABASE_URL — работаем на встроенном PGlite с данными из сида. */
export function isDemo(): boolean {
  return !env('DATABASE_URL');
}

/**
 * Секрет подписи cookie сессии.
 * Вне демо SESSION_SECRET обязателен (32+ символа) — иначе вход не работает (бросаем ошибку).
 * В демо — заданный SESSION_SECRET, если он годится, иначе фиксированный демо-секрет.
 */
export function sessionSecret(): string {
  const secret = env('SESSION_SECRET');
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (isDemo()) return DEMO_SESSION_SECRET;
  throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
}

/** Публичный адрес платформы без завершающего слэша (ссылки в письмах, QR сертификатов). */
export function siteUrl(): string {
  const explicit = env('NEXT_PUBLIC_SITE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = env('VERCEL_PROJECT_PRODUCTION_URL') ?? env('VERCEL_URL');
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}
