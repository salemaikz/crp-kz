// seedPermitted и seedRefusal: матрица окружений (D-040).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedPermitted, seedRefusal } from '../../src/lib/db/seed-guard';

const DATABASE_URL = 'postgres://app:secret-pass@db.internal:5432/crp';

test('seedPermitted: матрица окружений', () => {
  assert.equal(seedPermitted({ DEMO_MODE: '1', NODE_ENV: 'production' }), true);
  assert.equal(seedPermitted({ NODE_ENV: 'production', DATABASE_URL, SEED_DEMO: '1' }), false);
  assert.equal(seedPermitted({ NODE_ENV: 'production', DATABASE_URL, SEED_DEMO: '1', DEMO_MODE: '1' }), true);
  assert.equal(seedPermitted({ NODE_ENV: 'development', DATABASE_URL, SEED_DEMO: '1' }), true);
  assert.equal(seedPermitted({ NODE_ENV: 'test', DATABASE_URL, SEED_DEMO: '1' }), true);
  assert.equal(seedPermitted({ DATABASE_URL }), false);
  assert.equal(seedPermitted({}), true);
  assert.equal(seedPermitted({ VERCEL: '1', NODE_ENV: 'production' }), true);
  // остаточный риск D-040: tsx без NODE_ENV с боевым адресом и SEED_DEMO=1
  assert.equal(seedPermitted({ DATABASE_URL, SEED_DEMO: '1' }), true);
});

test('seedRefusal: текст есть и не содержит пароля, адреса и значений', () => {
  const text = seedRefusal({ NODE_ENV: 'production', DATABASE_URL, SEED_DEMO: '1' });
  assert.ok(text);
  assert.match(text, /DEMO_MODE/);
  for (const bad of ['demo12345', 'secret-pass', 'db.internal']) assert.equal(text.includes(bad), false);
  assert.equal(seedRefusal({ NODE_ENV: 'production', DATABASE_URL, SEED_DEMO: '1', DEMO_MODE: '1' }), null);
  assert.ok(seedRefusal({ DATABASE_URL }));
});
