// /api/health: getHealth (ok, миграции не накатаны, сбой БД, зависание) и обработчик маршрута.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../../src/app/api/health/route';
import { MigrationsPendingError } from '../../src/lib/db/migrate';
import { createTestDb } from '../../src/lib/db/testing';
import { getHealth } from '../../src/lib/ops/health';
import type { ReleaseInfo } from '../../src/lib/ops/release';

const RELEASE: ReleaseInfo = { id: 'r-test-1', tag: 'v0.0.1', sha: 'c'.repeat(40), builtAt: 1 };

function quietErrors<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  return fn().finally(() => {
    console.error = orig;
  });
}

test('getHealth: накатанная БД — ok, релиз и время', async () => {
  const db = await createTestDb();
  try {
    const before = Date.now();
    const h = await getHealth({ release: RELEASE });
    assert.equal(h.status, 'ok');
    assert.deepEqual(h.checks, { db: 'ok', migrations: 'ok' });
    assert.equal(h.pendingCount, 0);
    assert.equal(h.release, 'r-test-1');
    assert.equal(h.sha, RELEASE.sha);
    assert.ok(h.time >= before);
    assert.ok(h.mode === 'demo' || h.mode === 'production');
  } finally {
    await db.close();
  }
});

test('getHealth: БД без миграций (зарегистрированная) — fail/pending со счётчиком', async () => {
  const db = await createTestDb({ migrate: false });
  try {
    const h = await getHealth({ release: RELEASE });
    assert.equal(h.status, 'fail');
    assert.equal(h.checks.db, 'ok');
    assert.equal(h.checks.migrations, 'pending');
    assert.ok(h.pendingCount > 0);
  } finally {
    await db.close();
  }
});

test('getHealth: getDb бросает MigrationsPendingError — fail/pending/pendingCount', async () => {
  const h = await getHealth({
    release: RELEASE,
    getDb: async () => {
      throw new MigrationsPendingError(['a.sql', 'b.sql']);
    },
  });
  assert.equal(h.status, 'fail');
  assert.deepEqual(h.checks, { db: 'ok', migrations: 'pending' });
  assert.equal(h.pendingCount, 2);
});

test('getHealth: ошибка из другого бандла (то же имя, не тот класс) тоже pending', async () => {
  const h = await getHealth({
    release: RELEASE,
    getDb: async () => {
      throw Object.assign(new Error('x'), { name: 'MigrationsPendingError', pending: ['a.sql'] });
    },
  });
  assert.equal(h.checks.migrations, 'pending');
  assert.equal(h.pendingCount, 1);
});

test('getHealth: произвольная ошибка — db fail, текста ошибки в ответе нет', async () => {
  await quietErrors(async () => {
    const h = await getHealth({
      release: RELEASE,
      getDb: async () => {
        throw Object.assign(new Error('password authentication failed for user "secret_user" at db.internal'), {
          code: '28P01',
        });
      },
    });
    assert.equal(h.status, 'fail');
    assert.deepEqual(h.checks, { db: 'fail', migrations: 'unknown' });
    assert.ok(!/secret_user|internal|password/i.test(JSON.stringify(h)));
  });
});

test('getHealth: в журнал уходит код ошибки, но не её текст', async () => {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.join(' '));
  try {
    await getHealth({
      release: RELEASE,
      getDb: async () => {
        throw Object.assign(new Error('SECRET-TEXT'), { code: '28P01' });
      },
    });
  } finally {
    console.error = orig;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /28P01/);
  assert.ok(!lines[0]!.includes('SECRET-TEXT'));
});

test('getHealth: зависший getDb — fail не позже timeoutMs + 200 мс', async () => {
  await quietErrors(async () => {
    const t = Date.now();
    const h = await getHealth({ release: RELEASE, timeoutMs: 150, getDb: () => new Promise(() => {}) });
    assert.equal(h.status, 'fail');
    assert.equal(h.checks.db, 'fail');
    assert.ok(Date.now() - t < 350, `ждали ${Date.now() - t} мс`);
  });
});

test('GET: 200, no-store, JSON без деталей', async () => {
  const db = await createTestDb();
  try {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.release, 'string');
    assert.equal(typeof body.time, 'number');
  } finally {
    await db.close();
  }
});

test('GET: миграции не накатаны — 503 с no-store', async () => {
  const db = await createTestDb({ migrate: false });
  try {
    const res = await GET();
    assert.equal(res.status, 503);
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    const body = (await res.json()) as { status: string; checks: { migrations: string } };
    assert.equal(body.status, 'fail');
    assert.equal(body.checks.migrations, 'pending');
  } finally {
    await db.close();
  }
});
