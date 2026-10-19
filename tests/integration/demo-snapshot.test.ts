// Снимок схемы демо-базы: загрузка, откат при битом файле, догон миграций, условия demoSnapshotPath.
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { demoSnapshotPath } from '../../src/lib/db';
import { listMigrations, migrate } from '../../src/lib/db/migrate';
import { createPgliteDb, openPglite, wrapPglite } from '../../src/lib/db/pglite';

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'crp-snap-'));
}

/** Снимок схемы по каталогу миграций; возвращает число применённых. */
async function makeSnapshot(file: string, migrationsDir: string) {
  const pg = await openPglite();
  const db = wrapPglite(pg);
  const applied = await migrate(db, migrationsDir);
  await writeFile(file, Buffer.from(await (await pg.dumpDataDir('gzip')).arrayBuffer()));
  await db.close();
  return applied.length;
}

test('снимок: схема на месте, migrate догоняет миграции, которых в снимке не было', async () => {
  const dir = await tmp();
  try {
    const all = await listMigrations();
    assert.ok(all.length > 1);
    const only = path.join(dir, 'm');
    mkdirSync(only);
    await copyFile(path.join('migrations', all[0]!), path.join(only, all[0]!));
    const file = path.join(dir, 'snap.tar.gz');
    assert.equal(await makeSnapshot(file, only), 1);

    const db = await createPgliteDb(undefined, { snapshotPath: file });
    try {
      assert.deepEqual(await migrate(db), all.slice(1));
      assert.deepEqual(await migrate(db), []); // идемпотентно
      const n = (await db.sql<{ n: number }>`SELECT count(*) AS n FROM users`)[0]?.n;
      assert.equal(n, 0); // сида в снимке нет
    } finally {
      await db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('битый и обрезанный снимок: откат на создание с нуля, без unhandled rejection', async () => {
  const dir = await tmp();
  const rejections: unknown[] = [];
  const onRej = (e: unknown) => rejections.push(e);
  process.on('unhandledRejection', onRej);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const good = path.join(dir, 'good.tar.gz');
    await makeSnapshot(good, path.join(process.cwd(), 'migrations'));
    const bytes = await readFile(good);
    const cases: Record<string, Buffer> = {
      garbage: Buffer.from('not a tarball'),
      truncated: bytes.subarray(0, Math.floor(bytes.length / 2)),
    };
    for (const [name, content] of Object.entries(cases)) {
      const file = path.join(dir, `${name}.tar.gz`);
      await writeFile(file, content);
      const db = await createPgliteDb(undefined, { snapshotPath: file });
      try {
        const rows = await db.sql<{ ok: number }>`SELECT 1 AS ok`;
        assert.equal(rows[0]?.ok, 1, name);
      } finally {
        await db.close();
      }
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(rejections, []);
  } finally {
    console.warn = warn;
    process.off('unhandledRejection', onRej);
    await rm(dir, { recursive: true, force: true });
  }
});

test('demoSnapshotPath: только демо в production и только если файл есть', async () => {
  const dir = await tmp();
  const keys = ['DATABASE_URL', 'DEMO_MODE', 'VERCEL', 'NODE_ENV'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const cwd = process.cwd();
  const warn = console.warn;
  console.warn = () => {};
  const set = (v: Record<string, string | undefined>) => {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env as Record<string, string | undefined>, v);
  };
  try {
    mkdirSync(path.join(dir, '.demo'));
    await writeFile(path.join(dir, '.demo', 'pglite-snapshot.tar.gz'), 'x');
    process.chdir(dir);
    set({ DEMO_MODE: '1', NODE_ENV: 'production' });
    assert.equal(demoSnapshotPath(), path.join(dir, '.demo', 'pglite-snapshot.tar.gz'));
    set({ DEMO_MODE: '1', NODE_ENV: 'development' });
    assert.equal(demoSnapshotPath(), undefined, 'dev');
    set({ DEMO_MODE: '1', NODE_ENV: 'test' });
    assert.equal(demoSnapshotPath(), undefined, 'test');
    set({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@localhost/x' });
    assert.equal(demoSnapshotPath(), undefined, 'DATABASE_URL');
    set({ NODE_ENV: 'production' });
    assert.equal(demoSnapshotPath(), undefined, 'production без демо');
  } finally {
    process.chdir(cwd);
    console.warn = warn;
    const env = process.env as Record<string, string | undefined>;
    for (const k of keys) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
