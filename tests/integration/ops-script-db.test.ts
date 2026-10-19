// openScriptDb: отказ для БД в памяти, успешное открытие, миграции без DDL на актуальной схеме.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getDb, openScriptDb } from '../../src/lib/db';
import { listMigrations, migrate } from '../../src/lib/db/migrate';
import { createTestDb } from '../../src/lib/db/testing';

function saveEnv() {
  const saved = { u: process.env.DATABASE_URL, d: process.env.PGLITE_DIR };
  delete process.env.DATABASE_URL;
  delete process.env.PGLITE_DIR;
  return () => {
    if (saved.u === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.u;
    if (saved.d === undefined) delete process.env.PGLITE_DIR;
    else process.env.PGLITE_DIR = saved.d;
  };
}

test('openScriptDb: без DATABASE_URL и PGLITE_DIR — отказ', async () => {
  const restore = saveEnv();
  try {
    await assert.rejects(openScriptDb(), /DATABASE_URL или PGLITE_DIR/);
  } finally {
    restore();
  }
});

test('openScriptDb: PGLITE_DIR — открывает, регистрирует getDb и закрывает', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-script-'));
  const restore = saveEnv();
  process.env.PGLITE_DIR = dir;
  try {
    const close = await openScriptDb();
    const db = await getDb();
    const [r] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM users`;
    assert.equal(r?.n, 0, 'сид не выполняется');
    await close();
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('openScriptDb: allowInMemory для тестов', async () => {
  const restore = saveEnv();
  try {
    const close = await openScriptDb({ allowInMemory: true });
    await close();
  } finally {
    restore();
  }
});

test('migrate на актуальной схеме не открывает транзакцию', async () => {
  const db = await createTestDb({ register: false });
  try {
    let tx = 0;
    const spy = { ...db, withTx: ((...a: Parameters<typeof db.withTx>) => (tx++, db.withTx(...a))) as typeof db.withTx };
    assert.deepEqual(await migrate(spy), []);
    assert.equal(tx, 0);
  } finally {
    await db.close();
  }
});

test('пустой каталог миграций — ошибка', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-empty-'));
  try {
    await assert.rejects(listMigrations(dir), /нет ни одного файла/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
);
