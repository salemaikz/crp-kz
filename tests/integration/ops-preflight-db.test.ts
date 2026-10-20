// Проверки preflight через БД: демо-пользователи, суперпользователь и право CREATE (только Postgres).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seed } from '../../src/lib/db/seed';
import { createTestDb } from '../../src/lib/db/testing';
import { checkProductionDb } from '../../src/lib/ops/preflight';

const codes = (r: { code: string }[]) => r.map((i) => i.code);

test('БД с сидом — demo_users_present', async () => {
  const db = await createTestDb();
  try {
    await seed(db);
    assert.ok(codes(await checkProductionDb(db)).includes('demo_users_present'));
  } finally {
    await db.close();
  }
});

test('пустая БД после миграций — demo_users_present нет', async () => {
  const db = await createTestDb();
  try {
    assert.ok(!codes(await checkProductionDb(db)).includes('demo_users_present'));
  } finally {
    await db.close();
  }
});

test('нет таблицы users (первая выкладка до миграций) — не падает, демо-пользователей нет', async () => {
  const db = await createTestDb({ migrate: false });
  try {
    assert.ok(!codes(await checkProductionDb(db)).includes('demo_users_present'));
  } finally {
    await db.close();
  }
});

test('PGlite: db_superuser и db_can_create не проверяются', async (t) => {
  const db = await createTestDb();
  try {
    if (db.driver !== 'pglite') return t.skip('только PGlite');
    const c = codes(await checkProductionDb(db));
    assert.ok(!c.includes('db_superuser') && !c.includes('db_can_create'));
  } finally {
    await db.close();
  }
});

test('Postgres: preflight видит суперпользователя и право CREATE у текущей роли', async (t) => {
  const db = await createTestDb();
  try {
    if (db.driver !== 'postgres') return t.skip('нужен TEST_DATABASE_URL');
    const [r] = await db.sql<{ rolsuper: boolean }>`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
    const c = codes(await checkProductionDb(db));
    assert.equal(c.includes('db_superuser'), Boolean(r?.rolsuper));
    assert.ok(c.includes('db_can_create'), 'владелец тестовой схемы может создавать в ней таблицы');
  } finally {
    await db.close();
  }
});
