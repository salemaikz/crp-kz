// Проверка здоровья для /api/health, выкладки и монитора. Нормативно: docs/lms/design/ops.md §3.14, D-028.
// Наружу идут только статусы, счётчик и id релиза: без текстов ошибок, хостов и имён таблиц.
import type { Db } from '../db';
import { isDemo } from '../env';
import { migrationStatus, MigrationsPendingError } from '../db/migrate';
import { readRelease, type ReleaseInfo } from './release';

export type HealthReport = {
  status: 'ok' | 'fail';
  release: string;
  sha: string | null;
  mode: 'production' | 'demo';
  checks: { db: 'ok' | 'fail'; migrations: 'ok' | 'pending' | 'unknown' };
  pendingCount: number;
  /** epoch-мс */
  time: number;
};

export const HEALTH_TIMEOUT_MS = 3000;

/** Ошибка из другого бандла Next не проходит instanceof: сверяем и по имени. */
function pendingCountOf(e: unknown): number | null {
  if (e instanceof MigrationsPendingError) return e.pending.length;
  if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'MigrationsPendingError') {
    const p = (e as { pending?: unknown }).pending;
    return Array.isArray(p) ? p.length : 1;
  }
  return null;
}

/** В журнал — только код ошибки, без текста, запроса и параметров. */
function errorCode(e: unknown): string {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  return 'unknown';
}

type Probe = Pick<HealthReport, 'checks' | 'pendingCount'>;

async function probe(getDb: () => Promise<Db>): Promise<Probe> {
  let db: Db;
  try {
    db = await getDb();
  } catch (e) {
    // production без накатанных миграций: getDb() fail closed (assertMigrated), БД при этом доступна
    const n = pendingCountOf(e);
    if (n !== null) return { checks: { db: 'ok', migrations: 'pending' }, pendingCount: n };
    throw e;
  }
  await db.sql`SELECT 1`;
  const st = await migrationStatus(db);
  if (st.pending.length > 0) return { checks: { db: 'ok', migrations: 'pending' }, pendingCount: st.pending.length };
  return { checks: { db: 'ok', migrations: 'ok' }, pendingCount: 0 };
}

export async function getHealth(
  deps: { getDb?: () => Promise<Db>; timeoutMs?: number; release?: ReleaseInfo } = {},
): Promise<HealthReport> {
  const release = deps.release ?? readRelease();
  const timeoutMs = deps.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const getDb = deps.getDb ?? (async () => (await import('../db')).getDb());

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), timeoutMs);
  });
  let result: Probe;
  try {
    result = await Promise.race([probe(getDb), timeout]);
  } catch (e) {
    console.error(`health: проверка не прошла, код ${errorCode(e)}`);
    result = { checks: { db: 'fail', migrations: 'unknown' }, pendingCount: 0 };
  } finally {
    clearTimeout(timer);
  }
  return {
    status: result.checks.db === 'ok' && result.checks.migrations === 'ok' ? 'ok' : 'fail',
    release: release.id,
    sha: release.sha,
    mode: isDemo() ? 'demo' : 'production',
    checks: result.checks,
    pendingCount: result.pendingCount,
    time: Date.now(),
  };
}
