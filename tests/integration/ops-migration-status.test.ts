// Состояние миграций: migrationStatus/assertMigrated (только SELECT), prepareDb, lock_timeout.
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareDb } from '../../src/lib/db';
import {
  assertMigrated,
  listMigrations,
  migrate,
  migrationStatus,
  MigrationsPendingError,
} from '../../src/lib/db/migrate';
import { createTestDb } from '../../src/lib/db/testing';

async function withDb<T>(fn: (db: Awaited<ReturnType<typeof createTestDb>>) => Promise<T>): Promise<T> {
  const db = await createTestDb({ register: false, migrate: false });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function tmpDir() {
  return mkdtemp(path.join(tmpdir(), 'crp-mig-'));
}

test('пустая база без schema_migrations: всё pending, assertMigrated бросает со списком', async () => {
  await withDb(async (db) => {
    const files = await listMigrations();
    const st = await migrationStatus(db);
    assert.deepEqual(st.applied, []);
    assert.deepEqual(st.pending, files);
    assert.deepEqual(st.unknown, []);
    await assert.rejects(assertMigrated(db), (e: unknown) => {
      assert.ok(e instanceof MigrationsPendingError);
      assert.deepEqual(e.pending, files);
      return true;
    });
    // проверка ничего не создала: таблицы всё ещё нет
    const [t] = await db.sql<{ ok: boolean }>`SELECT to_regclass('schema_migrations') IS NOT NULL AS ok`;
    assert.equal(t?.ok, false);
  });
});

test('после migrate: pending пуст, assertMigrated проходит', async () => {
  await withDb(async (db) => {
    const files = await listMigrations();
    assert.deepEqual(await migrate(db), files);
    const st = await migrationStatus(db);
    assert.deepEqual(st.pending, []);
    assert.deepEqual(st.applied, files);
    await assertMigrated(db);
  });
});

test('лишний файл на диске даёт pending; удалённый файл — unknown и не ошибка', async () => {
  const dir = await tmpDir();
  try {
    await withDb(async (db) => {
      await migrate(db);
      const files = await listMigrations();
      for (const f of files) await copyFile(path.join('migrations', f), path.join(dir, f));
      await writeFile(path.join(dir, '2099-01-01-x.sql'), 'SELECT 1;\n');
      const st = await migrationStatus(db, dir);
      assert.deepEqual(st.pending, ['2099-01-01-x.sql']);
      await assert.rejects(assertMigrated(db, dir), MigrationsPendingError);

      // БД новее кода: на диске только первая миграция
      const only = await tmpDir();
      try {
        await copyFile(path.join('migrations', files[0]!), path.join(only, files[0]!));
        const st2 = await migrationStatus(db, only);
        assert.deepEqual(st2.pending, []);
        assert.deepEqual(st2.unknown, files.slice(1));
        await assertMigrated(db, only);
      } finally {
        await rm(only, { recursive: true, force: true });
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prepareDb: без автонакатки пустая база — ошибка, накатанная — проходит; с автонакаткой накатывает', async () => {
  await withDb(async (db) => {
    await assert.rejects(prepareDb(db, { autoMigrate: false, seed: false }), MigrationsPendingError);
    await prepareDb(db, { autoMigrate: true, seed: false });
    assert.deepEqual((await migrationStatus(db)).pending, []);
    await prepareDb(db, { autoMigrate: false, seed: false }); // накатанная база: только проверка
    const [u] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM users`;
    assert.equal(u?.n, 0, 'без seed пользователей нет');
  });
});

test('prepareDb с seed заполняет пустую базу один раз', async () => {
  await withDb(async (db) => {
    await prepareDb(db, { autoMigrate: true, seed: true });
    const [a] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM users`;
    assert.ok((a?.n ?? 0) > 0);
    await prepareDb(db, { autoMigrate: false, seed: true });
    const [b] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM users`;
    assert.equal(b?.n, a?.n);
  });
});

test('migrate с lockTimeoutMs выставляет lock_timeout внутри транзакции', async () => {
  const dir = await tmpDir();
  try {
    await writeFile(
      path.join(dir, '2099-01-01-lock-probe.sql'),
      "CREATE TABLE IF NOT EXISTS lock_probe (v TEXT);\nINSERT INTO lock_probe SELECT current_setting('lock_timeout');\n",
    );
    await withDb(async (db) => {
      assert.deepEqual(await migrate(db, dir, { lockTimeoutMs: 1234 }), ['2099-01-01-lock-probe.sql']);
      const [r] = await db.sql<{ v: string }>`SELECT v FROM lock_probe`;
      assert.equal(r?.v, '1234ms');
      // за пределами транзакции настройка не осталась
      const [after] = await db.sql<{ v: string }>`SELECT current_setting('lock_timeout') AS v`;
      assert.notEqual(after?.v, '1234ms');
    });
    await withDb(async (db) => {
      await assert.rejects(migrate(db, dir, { lockTimeoutMs: -1 }), /lockTimeoutMs/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
