// deploy/postgres/grants.sql на настоящем Postgres: права роли приложения проверяются реальными
// запросами от её имени (SET ROLE). Без TEST_DATABASE_URL тесты пропускаются: в PGlite ролей нет.
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { DbHandle } from '../../src/lib/db';
import { migrate, migrationStatus, migrationsDir } from '../../src/lib/db/migrate';
import { createTestDb } from '../../src/lib/db/testing';
import { applyGrants } from '../../src/lib/ops/grants';

const APP = 'crp_app_t';
const OWNER = 'crp_owner_t';
const GRANTS_FILE = path.join(import.meta.dirname, '..', '..', 'deploy', 'postgres', 'grants.sql');
const skip = process.env.TEST_DATABASE_URL?.trim() ? false : 'нужен TEST_DATABASE_URL (роли есть только в Postgres)';

/** Тестовая схема с миграциями и выданными правами; роли создаются идемпотентно (NOLOGIN). */
async function setup(): Promise<{ db: DbHandle; schema: string }> {
  const db = await createTestDb({ register: false });
  for (const role of [APP, OWNER]) {
    try {
      await db.exec(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    } catch (e) {
      // у тестового пользователя нет права CREATEROLE: роли и членство в них должен выдать администратор кластера
      if ((e as { code?: string }).code !== '42501') throw e;
      const [r] = await db.sql<{ ok: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS ok`;
      assert.ok(r?.ok, `нет роли ${role}: создайте её (NOLOGIN) и выдайте тестовому пользователю`);
    }
  }
  const [s] = await db.sql<{ schema: string }>`SELECT current_schema() AS schema`;
  const schema = s!.schema;
  // владелец схемы в проде создаёт в ней таблицы; в тесте даём ему CREATE, чтобы проверить default privileges
  await db.exec(`GRANT USAGE, CREATE ON SCHEMA ${schema} TO ${OWNER}`);
  await applyGrants(db, { app: APP, owner: OWNER }, GRANTS_FILE);
  return { db, schema };
}

/** Выполнить fn от имени роли приложения в отдельной транзакции (откат по завершении). */
async function asApp<T>(db: DbHandle, fn: () => Promise<T>, role = APP): Promise<T> {
  const ROLLBACK = new Error('rollback');
  let out: T | undefined;
  try {
    await db.withTx(async (c) => {
      await c.exec(`SET LOCAL ROLE ${role}`);
      out = await fn();
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return out as T;
}

async function denied(db: DbHandle, fn: () => Promise<unknown>) {
  await assert.rejects(asApp(db, fn), (e: unknown) => {
    assert.equal((e as { code?: string }).code, '42501', `ожидали 42501, получили ${(e as { code?: string }).code}`);
    return true;
  });
}

test('crp_app: SELECT/INSERT/UPDATE/DELETE на обычных таблицах', { skip }, async () => {
  const { db } = await setup();
  try {
    await asApp(db, async () => {
      await db.sql`INSERT INTO courses (id, slug, title, created_at, updated_at) VALUES ('c-grants', 'grants-test', ${db.json({ ru: 'Тест' })}, 1, 1)`;
      await db.sql`UPDATE courses SET position = 3 WHERE id = 'c-grants'`;
      const rows = await db.sql<{ id: string }>`SELECT id FROM courses WHERE id = 'c-grants'`;
      assert.equal(rows.length, 1);
      await db.sql`DELETE FROM courses WHERE id = 'c-grants'`;
    });
  } finally {
    await db.close();
  }
});

test('audit_log: INSERT и SELECT проходят, UPDATE, DELETE, TRUNCATE — 42501', { skip }, async () => {
  const { db } = await setup();
  try {
    await db.sql`INSERT INTO audit_log (id, actor_id, action, entity, entity_id, created_at) VALUES ('a0', NULL, 'system.test', 'system', 'x', 1)`;
    await asApp(db, async () => {
      await db.sql`INSERT INTO audit_log (id, actor_id, action, entity, entity_id, created_at) VALUES ('a1', NULL, 'system.test', 'system', 'x', 2)`;
      const rows = await db.sql<{ id: string }>`SELECT id FROM audit_log`;
      assert.ok(rows.length >= 2);
    });
    await denied(db, () => db.sql`UPDATE audit_log SET action = 'x' WHERE id = 'a0'`);
    await denied(db, () => db.sql`DELETE FROM audit_log WHERE id = 'a0'`);
    await denied(db, () => db.sql`TRUNCATE audit_log`);
  } finally {
    await db.close();
  }
});

test('schema_migrations: SELECT проходит, INSERT, UPDATE, DELETE — 42501; CREATE TABLE — 42501', { skip }, async () => {
  const { db } = await setup();
  try {
    await asApp(db, async () => {
      const rows = await db.sql<{ name: string }>`SELECT name FROM schema_migrations`;
      assert.ok(rows.length > 0);
    });
    await denied(db, () => db.sql`INSERT INTO schema_migrations (name, applied_at) VALUES ('2099-01-01-x.sql', 1)`);
    await denied(db, () => db.sql`UPDATE schema_migrations SET applied_at = 1`);
    await denied(db, () => db.sql`DELETE FROM schema_migrations`);
    await denied(db, () => db.exec('CREATE TABLE grants_probe (id TEXT)'));
  } finally {
    await db.close();
  }
});

test('migrationStatus работает от crp_app, migrate с ненакатанной миграцией — 42501', { skip }, async () => {
  const { db } = await setup();
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-grants-mig-'));
  try {
    for (const f of await readdir(migrationsDir())) await copyFile(path.join(migrationsDir(), f), path.join(dir, f));
    await asApp(db, async () => {
      const st = await migrationStatus(db, dir);
      assert.deepEqual(st.pending, []);
    });
    await writeFile(path.join(dir, '2099-01-01-grants-probe.sql'), 'SELECT 1;\n');
    await asApp(db, async () => {
      assert.deepEqual((await migrationStatus(db, dir)).pending, ['2099-01-01-grants-probe.sql']);
    });
    await denied(db, async () => {
      await migrate(db, dir);
    });
    // на актуальной схеме migrate от роли приложения не делает DDL и не падает
    await rm(path.join(dir, '2099-01-01-grants-probe.sql'));
    await asApp(db, async () => {
      assert.deepEqual(await migrate(db, dir), []);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
    await db.close();
  }
});

test('повторный прогон grants.sql идемпотентен, права не меняются', { skip }, async () => {
  const { db } = await setup();
  try {
    await applyGrants(db, { app: APP, owner: OWNER }, GRANTS_FILE);
    await applyGrants(db, { app: APP, owner: OWNER }, GRANTS_FILE);
    await denied(db, () => db.sql`DELETE FROM audit_log`);
    await asApp(db, async () => {
      await db.sql`SELECT count(*) FROM users`;
    });
  } finally {
    await db.close();
  }
});

test('таблица, созданная владельцем после выдачи прав, сразу доступна crp_app', { skip }, async () => {
  const { db } = await setup();
  try {
    await asApp(
      db,
      async () => {
        await db.exec('CREATE TABLE grants_later (id TEXT PRIMARY KEY)');
        // создана ролью-владельцем внутри транзакции теста: права приходят из ALTER DEFAULT PRIVILEGES
        await db.exec(`SET LOCAL ROLE ${APP}`);
        await db.sql`INSERT INTO grants_later (id) VALUES ('x')`;
        const rows = await db.sql<{ id: string }>`SELECT id FROM grants_later`;
        assert.equal(rows.length, 1);
        await db.sql`DELETE FROM grants_later`;
      },
      OWNER,
    );
  } finally {
    await db.close();
  }
});

test('имена ролей проверяются: недопустимое имя — ошибка до обращения к БД', { skip }, async () => {
  const { db } = await setup();
  try {
    await assert.rejects(applyGrants(db, { app: 'crp_app; DROP TABLE users', owner: OWNER }, GRANTS_FILE), /имя роли/);
  } finally {
    await db.close();
  }
});
