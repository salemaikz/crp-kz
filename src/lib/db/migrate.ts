// Раннер миграций: migrations/*.sql по алфавиту, учёт в schema_migrations (D-012).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DbHandle } from './core';

/** Ключ advisory-блокировки: параллельные процессы не накатывают миграции одновременно. */
const MIGRATION_LOCK_KEY = 72_026_101_901;
const NAME_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/;

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'migrations');
}

export async function listMigrations(dir = migrationsDir()): Promise<string[]> {
  const files = await readdir(dir);
  return files.filter((f) => NAME_RE.test(f)).sort();
}

/** Применяет ненакатанные миграции в одной транзакции. Возвращает имена применённых. */
export async function migrate(db: DbHandle, dir = migrationsDir()): Promise<string[]> {
  const files = await listMigrations(dir);
  return db.withTx(async (c) => {
    await c.sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
    await c.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)',
    );
    const done = new Set(
      (await c.sql<{ name: string }>`SELECT name FROM schema_migrations`).map((r) => r.name),
    );
    const applied: string[] = [];
    for (const name of files) {
      if (done.has(name)) continue;
      const script = await readFile(path.join(dir, name), 'utf8');
      await c.exec(script);
      await c.sql`INSERT INTO schema_migrations (name, applied_at) VALUES (${name}, ${Date.now()})`;
      applied.push(name);
    }
    return applied;
  });
}
