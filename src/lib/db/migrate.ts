// Раннер миграций: migrations/*.sql по алфавиту, учёт в schema_migrations (D-012).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db, DbHandle } from './core';
import { MIGRATION_LOCK_KEY } from './locks';

const NAME_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/;

export function migrationsDir(): string {
  // Подмена каталога — только для тестов и разработки. В production молча игнорировать её нельзя:
  // приложение и ручной db:status разошлись бы в наборе файлов, поэтому это ошибка конфигурации
  const override = process.env.MIGRATIONS_DIR?.trim();
  if (override && process.env.NODE_ENV === 'production') {
    throw new Error('MIGRATIONS_DIR задан в production: переменная только для тестов и разработки, уберите её из окружения.');
  }
  return override || path.join(process.cwd(), 'migrations');
}

export async function listMigrations(dir = migrationsDir()): Promise<string[]> {
  const files = await readdir(dir);
  const list = files.filter((f) => NAME_RE.test(f)).sort();
  // Пустой каталог — это неверный путь или битая выкладка, а не «всё накатано»
  if (list.length === 0) throw new Error(`В каталоге миграций нет ни одного файла: ${dir}`);
  return list;
}

export type MigrationStatus = {
  /** На диске, по алфавиту. */
  files: string[];
  /** В schema_migrations. */
  applied: string[];
  /** На диске, но не накатаны. */
  pending: string[];
  /** Накатаны, но файла нет (БД новее кода — норма после отката релиза). */
  unknown: string[];
};

/** Чистое сравнение списков: дубликаты не размножаются, результат отсортирован. */
export function diffMigrations(files: string[], applied: string[]): MigrationStatus {
  const f = [...new Set(files)].sort();
  const a = [...new Set(applied)].sort();
  const onDisk = new Set(f);
  const done = new Set(a);
  return {
    files: f,
    applied: a,
    pending: f.filter((n) => !done.has(n)),
    unknown: a.filter((n) => !onDisk.has(n)),
  };
}

/**
 * Состояние миграций. Только SELECT: работает от роли приложения без права на DDL.
 * Нет таблицы schema_migrations — все файлы pending.
 */
export async function migrationStatus(db: Pick<Db, 'sql'>, dir = migrationsDir()): Promise<MigrationStatus> {
  const files = await listMigrations(dir);
  const [t] = await db.sql<{ ok: boolean }>`SELECT to_regclass('schema_migrations') IS NOT NULL AS ok`;
  const applied = t?.ok ? (await db.sql<{ name: string }>`SELECT name FROM schema_migrations`).map((r) => r.name) : [];
  return diffMigrations(files, applied);
}

export class MigrationsPendingError extends Error {
  constructor(readonly pending: string[]) {
    super(
      `Не накатаны миграции (${pending.length}): ${pending.join(', ')}. ` +
        'Выполните npm run db:migrate от роли с правом на DDL.',
    );
    this.name = 'MigrationsPendingError';
  }
}

/** Fail closed: есть ненакатанные миграции — ошибка со списком. Лишние накатанные (БД новее) — не ошибка. */
export async function assertMigrated(db: Pick<Db, 'sql'>, dir = migrationsDir()): Promise<void> {
  const { pending } = await migrationStatus(db, dir);
  if (pending.length > 0) throw new MigrationsPendingError(pending);
}

/**
 * Применяет ненакатанные миграции в одной транзакции. Возвращает имена применённых.
 * lockTimeoutMs — сколько ждать блокировку таблицы (lock_timeout действует до конца транзакции).
 */
export async function migrate(
  db: DbHandle,
  dir = migrationsDir(),
  opts: { lockTimeoutMs?: number } = {},
): Promise<string[]> {
  // Нечего накатывать — ни транзакции, ни блокировки, ни DDL: роль без права CREATE
  // не должна падать на актуальной схеме
  if ((await migrationStatus(db, dir)).pending.length === 0) return [];
  const files = await listMigrations(dir);
  return db.withTx(async (c) => {
    await c.sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
    if (opts.lockTimeoutMs !== undefined) {
      if (!Number.isSafeInteger(opts.lockTimeoutMs) || opts.lockTimeoutMs < 0) {
        throw new Error('lockTimeoutMs must be a non-negative integer');
      }
      await c.sql`SELECT set_config('lock_timeout', ${String(opts.lockTimeoutMs)}, true)`;
    }
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
