// db:seed и db:status: отказ вне демо, сид по SEED_DEMO=1, БД в памяти для status — код 2.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createPgliteDb } from '../../src/lib/db/pglite';
import { seedRefusal } from '../../src/lib/db/seed-guard';
import { migrate } from '../../src/lib/db/migrate';

const ROOT = path.join(import.meta.dirname, '..', '..');

/** Запуск скрипта в чистом окружении: ничего из демо-переменных родителя не просачивается. */
function run(script: string, args: string[], extra: Record<string, string>) {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(DATABASE_URL|TEST_DATABASE_URL|PGLITE_DIR|NODE_ENV|DEMO_MODE|SEED_DEMO|VERCEL|MIGRATIONS_DIR)$/.test(k)) continue;
    env[k] = v;
  }
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    env: { ...env, ...extra } as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

async function usersCount(dir: string): Promise<number> {
  const db = await createPgliteDb(dir);
  try {
    await migrate(db);
    const [r] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    return r?.n ?? -1;
  } finally {
    await db.close();
  }
}

test('seedRefusal: настоящая БД без DEMO_MODE/SEED_DEMO — отказ без пароля и адреса', () => {
  const url = 'postgres://app:secret-pass@db.internal:5432/crp';
  const text = seedRefusal({ DATABASE_URL: url });
  assert.ok(text);
  assert.equal(text.includes('demo12345'), false);
  assert.equal(text.includes('secret-pass'), false);
  assert.equal(text.includes('db.internal'), false);
  assert.equal(seedRefusal({ DATABASE_URL: url, SEED_DEMO: '1' }), null);
  assert.equal(seedRefusal({ DATABASE_URL: url, DEMO_MODE: '1' }), null);
  assert.equal(seedRefusal({}), null, 'локальная разработка без БД — демо');
});

test('db-seed: вне демо — код 1 и users пуста; с SEED_DEMO=1 (без production) — засевает', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-seed-'));
  try {
    const denied = run('db-seed.ts', [], { PGLITE_DIR: dir, NODE_ENV: 'production' });
    assert.equal(denied.status, 1, denied.stderr);
    assert.match(denied.stderr, /не демо-окружение/);
    assert.equal(denied.stderr.includes('demo12345'), false);
    assert.equal(await usersCount(dir), 0);

    const ok = run('db-seed.ts', [], { PGLITE_DIR: dir, SEED_DEMO: '1' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok((await usersCount(dir)) > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('db-migrate --status: БД в памяти — код 2 и то же сообщение, что у openScriptDb', () => {
  const r = run('db-migrate.ts', ['--status'], {});
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /База в памяти исчезнет после выхода скрипта: задайте DATABASE_URL или PGLITE_DIR\./);
});
