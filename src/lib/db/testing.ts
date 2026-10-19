// Тестовая БД: свежий PGlite в памяти с миграциями. Регистрируется как getDb() этого процесса
// (node --test запускает каждый файл в своём процессе — изоляция по файлу).
// TEST_DATABASE_URL — те же тесты на настоящем Postgres: каждая БД в своей временной схеме.
import { randomUUID } from 'node:crypto';
import type { DbHandle } from './core';
import { setDb } from './index';
import { migrate } from './migrate';
import { createPgliteDb } from './pglite';

export type TestDb = DbHandle;

async function createPostgresTestDb(url: string): Promise<DbHandle> {
  const { createPostgresDb } = await import('./postgres');
  const schema = `test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = await createPostgresDb(url);
  await admin.exec(`CREATE SCHEMA ${schema}`);
  const db = await createPostgresDb(url, { schema });
  return {
    ...db,
    close: async () => {
      await db.close();
      await admin.exec(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    },
  };
}

/** migrate: false — пустая база без миграций (проверки состояния миграций). */
export async function createTestDb(opts: { register?: boolean; migrate?: boolean } = {}): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  const db = url ? await createPostgresTestDb(url) : await createPgliteDb();
  if (opts.migrate !== false) await migrate(db);
  if (opts.register !== false) setDb(db);
  return db;
}
