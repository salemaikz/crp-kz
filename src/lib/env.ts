// Окружение: режим демо, секрет сессии, публичный адрес. Нормативно: docs/lms/BUILD.md §2, §5.

/** Фиксированный секрет для демо на PGlite (без реальных данных). Больше нигде не используется. */
const DEMO_SESSION_SECRET = 'crp-demo-session-secret--not-for-production--2026-10-19';
const MIN_SECRET_LENGTH = 32;

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Демо-режим (PGlite или Postgres с демо-данными, кнопки демо-входа, плашка «Демо-версия»).
 * Включается только явно: DEMO_MODE=1, локальная разработка/тесты без DATABASE_URL
 * (NODE_ENV не production) или превью на Vercel без DATABASE_URL (VERCEL=1).
 * В production на своём сервере без DATABASE_URL и без DEMO_MODE=1 приложение
 * не стартует (getDb бросает ошибку, см. assertDbConfigured) — «тихого» демо в проде нет.
 */
export function isDemo(): boolean {
  if (env('DEMO_MODE') === '1') return true;
  if (env('DATABASE_URL')) return false;
  return process.env.NODE_ENV !== 'production' || isVercelPreviewHost();
}

/**
 * Vercel используется только для демо-превью (D-015, D-016): прод — сервер ЦРП в РК
 * с DATABASE_URL. Поэтому на Vercel без DATABASE_URL демо включается само — импорт
 * репозитория в Vercel работает без ручной настройки переменных.
 */
function isVercelPreviewHost(): boolean {
  return process.env.VERCEL === '1';
}

/**
 * Проверка конфигурации БД перед открытием драйвера (fail closed):
 * production без DATABASE_URL допустим только при явном DEMO_MODE=1.
 */
export function assertDbConfigured(): void {
  if (env('DATABASE_URL')) return;
  if (process.env.NODE_ENV === 'production' && !isDemo()) {
    throw new Error(
      'DATABASE_URL is not set in production. Set DATABASE_URL, or set DEMO_MODE=1 explicitly ' +
        'for a demo preview with in-memory demo data (no real personal data).',
    );
  }
}

/**
 * Секрет подписи cookie сессии.
 * Заданный SESSION_SECRET короче 32 символов — всегда ошибка (и в демо): лучше не стартовать,
 * чем подписывать cookie слабым ключом.
 * Без SESSION_SECRET фиксированный демо-секрет допустим только в демо на встроенном PGlite
 * (нет DATABASE_URL); вне демо и в демо на настоящем Postgres — ошибка, вход не работает.
 */
export function sessionSecret(): string {
  const secret = env('SESSION_SECRET');
  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) throw new Error('SESSION_SECRET is shorter than 32 characters');
    return secret;
  }
  if (isDemo() && !env('DATABASE_URL')) return DEMO_SESSION_SECRET;
  throw new Error('SESSION_SECRET is missing (required outside the in-memory demo, 32+ characters)');
}

/** Публичный адрес платформы без завершающего слэша (ссылки в письмах, QR сертификатов). */
export function siteUrl(): string {
  const explicit = env('NEXT_PUBLIC_SITE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = env('VERCEL_PROJECT_PRODUCTION_URL') ?? env('VERCEL_URL');
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}
