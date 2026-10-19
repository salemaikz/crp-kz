// Точка входа слоя БД: один интерфейс, два драйвера. Нормативно: docs/lms/BUILD.md §2.
//
// Правила SQL (одинаковы для обоих драйверов):
// - только tagged template со значениями в ${}; без вложенных sql``, sql(obj), sql.unsafe, склейки строк;
// - списки: = ANY(${ids}); jsonb: ${db.json(v)}, читается уже объектом;
// - колонки snake_case в БД → camelCase в строках; BIGINT → number;
// - внутри db.tx(fn) используйте sql из колбэка (вызовы db.sql тоже попадут в транзакцию).
import { isDemo } from '../env';
import type { Db, DbHandle } from './core';
import { migrate } from './migrate';

export type { Db, DbHandle, Row, Sql } from './core';
export { isUniqueViolation } from './core';

type DbGlobal = typeof globalThis & { __crpDb?: { promise: Promise<DbHandle> } };
const g = globalThis as DbGlobal;

/** Открыть драйвер без миграций и сида (скрипты npm run db:*). */
export async function openDriver(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { createPostgresDb } = await import('./postgres');
    return createPostgresDb(url);
  }
  const { createPgliteDb } = await import('./pglite');
  return createPgliteDb(process.env.PGLITE_DIR?.trim() || undefined);
}

function shouldSeed(): boolean {
  return isDemo() || process.env.SEED_DEMO === '1';
}

async function init(): Promise<DbHandle> {
  const db = await openDriver();
  try {
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
