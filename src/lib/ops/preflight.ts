// Проверка окружения перед выкладкой. Нормативно: docs/lms/design/ops.md §3.15, PLAN §5 (5A).
// Выход — только коды проблем без значений переменных: вывод попадает в журнал выкладки.
import type { Db } from '../db';
import { featureBlockers, FEATURES, isFeatureEnabled, type FeatureName } from '../features';
import type { Env } from '../env';

export type PreflightIssue = { level: 'error' | 'warn'; code: string };

/** Функции, включение которых в production включает и ПРЕДЛОЖЕННЫЕ правила, ждущие владельца. */
const PROPOSED_RULES: Partial<Record<FeatureName, string>> = {
  EMAIL_VERIFY: 'D-032', // заказ только с подтверждённого email
  LEGAL: 'D-035', // две галочки согласия
};

const DEFAULT_OWNER_ROLE = 'crp_owner';

function val(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/** Правила адреса БД; значение наружу не попадает. */
function databaseUrlIssues(env: Env): PreflightIssue[] {
  const raw = val(env, 'DATABASE_URL');
  if (!raw) return [{ level: 'error', code: 'database_url_missing' }];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [{ level: 'error', code: 'database_url_not_postgres' }];
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return [{ level: 'error', code: 'database_url_not_postgres' }];
  }
  const out: PreflightIssue[] = [];
  const ssl = url.searchParams.get('sslmode');
  if (ssl !== 'require' && ssl !== 'verify-ca' && ssl !== 'verify-full') {
    out.push({ level: 'error', code: 'database_url_no_ssl' });
  }
  let user = '';
  try {
    user = decodeURIComponent(url.username);
  } catch {
    // нечитаемое имя: считаем обычным
  }
  const owner = val(env, 'DB_OWNER_ROLE') ?? DEFAULT_OWNER_ROLE;
  if (user === 'postgres' || user === owner) out.push({ level: 'error', code: 'database_url_privileged_user' });
  return out;
}

/** Публичный адрес: задан, разбирается и только https; localhost для production не годится. */
function siteUrlIssues(env: Env): PreflightIssue[] {
  const raw = val(env, 'NEXT_PUBLIC_SITE_URL');
  if (!raw) return [{ level: 'error', code: 'site_url_not_https' }];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [{ level: 'error', code: 'site_url_not_https' }];
  }
  if (url.protocol !== 'https:') return [{ level: 'error', code: 'site_url_not_https' }];
  const h = url.hostname;
  if (h === 'localhost' || h === '[::1]' || /^127\./.test(h)) return [{ level: 'error', code: 'site_url_local' }];
  return [];
}

/** Чистая функция от env. Без значений в результате. */
export function checkProductionEnv(env: Env): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const err = (code: string) => out.push({ level: 'error', code });
  const warn = (code: string) => out.push({ level: 'warn', code });

  if (val(env, 'DEMO_MODE') === '1') err('demo_mode_set');
  if (val(env, 'PGLITE_DIR')) err('pglite_dir_set');
  if (val(env, 'MIGRATIONS_DIR')) err('migrations_dir_set');
  out.push(...databaseUrlIssues(env));

  const secret = val(env, 'SESSION_SECRET');
  if (!secret || secret.length < 32) err('session_secret_weak');

  out.push(...siteUrlIssues(env));

  if (val(env, 'TRUSTED_PROXY_HOPS') !== '1') err('proxy_hops_not_1');
  if (val(env, 'TRUST_X_REAL_IP') === '1') err('trust_x_real_ip_set');
  if (val(env, 'DB_MIGRATE_ON_START') === '1') err('auto_migrate_on');

  // Сид демо-данных засеял бы в пустую боевую БД админа с публичным паролем уже при smoke-старте,
  // а checkProductionDb сработает только на следующей выкладке: поэтому ошибка (ops §3.15)
  if (val(env, 'SEED_DEMO') === '1') err('seed_demo_set');
  if (!val(env, 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY')) warn('server_actions_key_missing');
  if (val(env, 'NEXT_TELEMETRY_DISABLED') !== '1') warn('telemetry_on');

  for (const name of FEATURES) {
    if (!isFeatureEnabled(name, env)) continue;
    warn(`feature_on:${name}`);
    // Включён, но не готов (почта-заглушка, нет https-адреса, юртексты не утверждены): функция всё равно не работает
    for (const b of featureBlockers(name, env)) warn(`feature_blocked:${name}:${b}`);
    if (PROPOSED_RULES[name]) warn(`proposed_rules:${name}`);
  }
  return out;
}

type PreflightDb = Pick<Db, 'sql'> & { driver?: Db['driver'] };

/** Проверки через БД от роли приложения. */
export async function checkProductionDb(db: PreflightDb): Promise<PreflightIssue[]> {
  const out: PreflightIssue[] = [];
  if (db.driver !== 'pglite') {
    const [role] = await db.sql<{ rolsuper: boolean }>`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
    if (role?.rolsuper) out.push({ level: 'error', code: 'db_superuser' });
    const [priv] = await db.sql<{ ok: boolean }>`SELECT has_schema_privilege(current_user, current_schema(), 'CREATE') AS ok`;
    if (priv?.ok) out.push({ level: 'error', code: 'db_can_create' });
  }
  // Таблицы ещё нет — первая выкладка до миграций: проверять нечего
  const [t] = await db.sql<{ ok: boolean }>`SELECT to_regclass('users') IS NOT NULL AS ok`;
  if (t?.ok) {
    const [demo] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM users WHERE email LIKE '%@crp.demo'`;
    if (Number(demo?.n ?? 0) > 0) out.push({ level: 'error', code: 'demo_users_present' });
  }
  return out;
}

/** Вывод: ERROR <код> / WARN <код> по строке. */
export function formatIssues(issues: PreflightIssue[]): string[] {
  return issues.map((i) => `${i.level === 'error' ? 'ERROR' : 'WARN'} ${i.code}`);
}

export function hasErrors(issues: PreflightIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
