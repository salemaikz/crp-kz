// npm run db:migrate — накатить миграции на DATABASE_URL (или PGLITE_DIR).
// npm run db:status (--status) — только чтение: накатанные, ненакатанные и незнакомые файлы.
import { openDriver } from '../src/lib/db';
import { migrate, migrationStatus } from '../src/lib/db/migrate';
import { isDemo } from '../src/lib/env';

const DEFAULT_LOCK_TIMEOUT_MS = 5000;

/** MIGRATE_LOCK_TIMEOUT_MS: целое положительное число миллисекунд. */
function lockTimeoutMs(raw = process.env.MIGRATE_LOCK_TIMEOUT_MS): number {
  const v = raw?.trim();
  if (!v) return DEFAULT_LOCK_TIMEOUT_MS;
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`MIGRATE_LOCK_TIMEOUT_MS должно быть целым положительным числом (мс), получено: ${v}`);
  }
  return n;
}

async function status(): Promise<number> {
  const db = await openDriver(); // без prepareDb и накатки
  try {
    const st = await migrationStatus(db);
    const list = (title: string, items: string[]) =>
      console.log(`${title} (${items.length})${items.length ? `:\n  ${items.join('\n  ')}` : ''}`);
    list('Накатаны', st.applied.filter((n) => !st.unknown.includes(n)));
    list('Не накатаны', st.pending);
    list('Незнакомые (накатаны, файла нет)', st.unknown);
    return st.pending.length > 0 ? 1 : 0;
  } finally {
    await db.close();
  }
}

async function apply(): Promise<number> {
  const timeout = lockTimeoutMs();
  if (isDemo() && !process.env.PGLITE_DIR && !process.env.DATABASE_URL) {
    console.log('DATABASE_URL и PGLITE_DIR не заданы: БД в памяти, миграции применяются при старте приложения.');
  }
  const db = await openDriver();
  try {
    const applied = await migrate(db, undefined, { lockTimeoutMs: timeout });
    console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'Новых миграций нет.');
    return 0;
  } finally {
    await db.close();
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0) return apply();
  if (args.length === 1 && args[0] === '--status') return status();
  console.error(
    'Использование: db-migrate.ts [--status]\n  без аргументов — накатить миграции\n  --status — показать состояние, код 1 при ненакатанных',
  );
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
