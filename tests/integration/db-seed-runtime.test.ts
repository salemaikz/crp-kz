// Сид в рантайме (D-040): SEED_DEMO=1 в production без DEMO_MODE не сеет, предупреждение одно на процесс.
// Отдельный файл: меняет process.env, а node --test гоняет файлы в разных процессах.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDb } from '../../src/lib/db';
import { createTestDb } from '../../src/lib/db/testing';

test('prepareDb: production + SEED_DEMO=1 не сеет и предупреждает один раз; с DEMO_MODE=1 сеет', async () => {
  const db = await createTestDb({ register: false });
  const saved = { ...process.env };
  const origWarn = console.warn;
  const warnings: string[] = [];
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.SEED_DEMO = '1';
    delete process.env.DEMO_MODE;
    delete process.env.VERCEL;
    console.warn = (...a: unknown[]) => void warnings.push(a.join(' '));

    await prepareDb(db, { autoMigrate: false });
    await prepareDb(db, { autoMigrate: false });
    const [r] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    assert.equal(r?.n, 0);
    assert.equal(warnings.filter((w) => w.includes('SEED_DEMO')).length, 1);

    process.env.DEMO_MODE = '1';
    await prepareDb(db, { autoMigrate: false });
    const [r2] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    assert.ok((r2?.n ?? 0) > 0);
  } finally {
    console.warn = origWarn;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    await db.close();
  }
});
