// Точка входа слоя БД: один интерфейс, два драйвера. Нормативно: docs/lms/BUILD.md §2.
//
// Правила SQL (одинаковы для обоих драйверов):
// - только tagged template со значениями в ${}; без вложенных sql``, sql(obj), sql.unsafe, склейки строк;
// - списки: = ANY(${ids}); jsonb: ${db.json(v)}, читается уже объектом;
// - колонки snake_case в БД → camelCase в строках; BIGINT → number;
// - внутри db.tx(fn) используйте sql из колбэка (вызовы db.sql тоже попадут в транзакцию).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertDbConfigured, isDemo } from '../env';
import type { Db, DbHandle } from './core';
import { migrate } from './migrate';
import { refreshSnapshotTime } from './snapshot';

export type { Db, DbHandle, Row, Sql } from './core';
export { isUniqueViolation } from './core';

export const DEMO_SNAPSHOT_REL = path.join('.demo', 'pglite-snapshot.tar.gz');

type DbGlobal = typeof globalThis & { __crpDb?: { promise: Promise<DbHandle> }; __crpSnapshotWarned?: boolean };
const g = globalThis as DbGlobal;

/** Открыть драйвер без миграций и сида (скрипты npm run db:*). */
export async function openDriver(): Promise<DbHandle> {
  assertDbConfigured(); // production без DATABASE_URL и без DEMO_MODE=1 — ошибка, а не тихое демо
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { createPostgresDb } = await import('./postgres');
    return createPostgresDb(url);
  }
  const { createPgliteDb } = await import('./pglite');
  const dir = process.env.PGLITE_DIR?.trim() || undefined;
  return createPgliteDb(dir, { snapshotPath: dir ? undefined : demoSnapshotPath() });
}

/**
 * Снимок демо-базы (схема + сид) (scripts/build-demo-snapshot.ts, prebuild): на serverless холодный
 * старт без initdb укладывается в лимит функции. В снимке уже есть сид, а даты при загрузке
 * сдвигаются на «сейчас − время сборки» (snapshot.ts), так что демо-данные свежие (BUILD.md §2). Берём его только в демо-проде:
 * в dev и тестах база создаётся с нуля. Нет файла — предупреждаем один раз.
 */
export function demoSnapshotPath(): string | undefined {
  if (!isDemo() || process.env.NODE_ENV !== 'production') return undefined;
  const file = path.join(process.cwd(), DEMO_SNAPSHOT_REL);
  if (existsSync(file)) return file;
  if (!g.__crpSnapshotWarned) {
    g.__crpSnapshotWarned = true;
    console.warn('Снимок демо-базы не найден, холодный старт будет медленным');
  }
  return undefined;
}

function shouldSeed(): boolean {
  return isDemo() || process.env.SEED_DEMO === '1';
}

async function init(): Promise<DbHandle> {
  const db = await openDriver();
  try {
    // снимок с сидом: сдвигаем даты до текущего момента, ДО migrate() и проверки users
    const snap = !process.env.DATABASE_URL?.trim() && !process.env.PGLITE_DIR?.trim() ? demoSnapshotPath() : undefined;
    if (snap) await refreshSnapshotTime(db, snap);
    await migrate(db);
    if (shouldSeed()) {
      const [row] = await db.sql<{ has: boolean }>`SELECT EXISTS (SELECT 1 FROM users) AS has`;
      if (!row?.has) {
        const { seed } = await import('./seed');
        await seed(db);
      }
    }
    return db;
  } catch (e) {
    await db.close().catch(() => {});
    throw e;
  }
}

/**
 * Ленивая инициализация: драйвер → миграции → сид (если users пуста и демо или SEED_DEMO=1).
 * Один экземпляр на процесс (переживает hot reload); параллельные вызовы ждут один промис.
 */
export function getDb(): Promise<Db> {
  if (!g.__crpDb) {
    const promise = init().catch((e) => {
      g.__crpDb = undefined; // следующий вызов попробует снова
      throw e;
    });
    g.__crpDb = { promise };
  }
  return g.__crpDb.promise;
}

/** Только для тестов и скриптов: подставить готовый экземпляр вместо ленивого. */
export function setDb(db: DbHandle | null): void {
  g.__crpDb = db ? { promise: Promise.resolve(db) } : undefined;
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}
