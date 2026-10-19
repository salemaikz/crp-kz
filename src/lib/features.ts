// Флаги функций (D-025). Только сервер: клиентскому компоненту значение передаётся пропсом.
// Нормативно: docs/lms/BUILD.md §13.
import { isDemo, siteUrlConfigured, type Env } from './env';
import { legalPublishable } from './legal/registry';
import { mailTransportName } from './mail/config';

export type { Env };

export const FEATURES = ['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS', 'UPLOADS', 'LEGAL', 'CERT_PDF'] as const;
export type FeatureName = (typeof FEATURES)[number];

const warned = new Set<string>();

/**
 * Выключатель: FEATURE_<NAME> '1' — вкл, '0' — выкл, не задан или пуст — isDemo(env).
 * Другое значение — выкл (fail closed) и одно предупреждение в лог на процесс.
 */
export function isFeatureEnabled(name: FeatureName, env: Env = process.env): boolean {
  const key = `FEATURE_${name}`;
  const raw = env[key]?.trim();
  if (raw === '1') return true;
  if (raw === '0') return false;
  if (raw === undefined || raw === '') return isDemo(env);
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`${key}: допустимы 1 и 0, функция выключена`);
  }
  return false;
}

export type FeatureBlocker = 'flag_off' | 'mail_outbox' | 'site_url' | 'legal_not_approved';

const MAIL_FEATURES: readonly FeatureName[] = ['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS'];

/**
 * Что мешает функции работать: выключатель и условия готовности (не зависят друг от друга,
 * поэтому при выключенном флаге в списке есть и готовность). В демо условий нет — только
 * 'flag_off'. Для preflight и тестов; в коде функций — isFeatureActive.
 */
export function featureBlockers(name: FeatureName, env: Env = process.env, opts: { today?: string } = {}): FeatureBlocker[] {
  const out: FeatureBlocker[] = [];
  if (!isFeatureEnabled(name, env)) out.push('flag_off');
  if (isDemo(env)) return out;
  if (MAIL_FEATURES.includes(name)) {
    if (mailTransportName(env) === 'outbox') out.push('mail_outbox');
    if (!siteUrlConfigured(env)) out.push('site_url');
  }
  if (name === 'CERT_PDF' && !siteUrlConfigured(env)) out.push('site_url');
  if (name === 'LEGAL' && !legalPublishable(opts.today)) out.push('legal_not_approved');
  return out;
}

/**
 * Работает ли функция: выключатель и условия готовности. ЕДИНСТВЕННАЯ проверка для страниц,
 * server actions, маршрутов, скриптов и меню.
 */
export function isFeatureActive(name: FeatureName, env: Env = process.env, opts: { today?: string } = {}): boolean {
  return featureBlockers(name, env, opts).length === 0;
}
