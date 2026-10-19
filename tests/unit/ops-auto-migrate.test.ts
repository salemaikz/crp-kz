// autoMigrateEnabled: миграции при старте — демо, разработка, тесты; в production только проверка (D-026).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoMigrateEnabled } from '../../src/lib/db';

const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x@h/db' };

test('production с DATABASE_URL: по умолчанию нет', () => {
  assert.equal(autoMigrateEnabled({ ...prod }), false);
  assert.equal(autoMigrateEnabled({ ...prod, DB_MIGRATE_ON_START: '' }), false);
  assert.equal(autoMigrateEnabled({ ...prod, DB_MIGRATE_ON_START: 'yes' }), false, 'не 1 — не включает');
});

test('production: DB_MIGRATE_ON_START=1 включает', () => {
  assert.equal(autoMigrateEnabled({ ...prod, DB_MIGRATE_ON_START: '1' }), true);
});

test('демо и разработка: да', () => {
  assert.equal(autoMigrateEnabled({ ...prod, DEMO_MODE: '1' }), true);
  assert.equal(autoMigrateEnabled({ NODE_ENV: 'test' }), true);
  assert.equal(autoMigrateEnabled({ NODE_ENV: 'development' }), true);
});

test('скрипт под tsx без NODE_ENV с DATABASE_URL: не накатывает (D-026)', () => {
  assert.equal(autoMigrateEnabled({ DATABASE_URL: 'postgres://x@h/db' }), false);
  assert.equal(autoMigrateEnabled({ DATABASE_URL: 'postgres://x@h/db', DB_MIGRATE_ON_START: '1' }), true);
});

test('DB_MIGRATE_ON_START=0 выключает и в разработке, и в демо', () => {
  assert.equal(autoMigrateEnabled({ NODE_ENV: 'development', DB_MIGRATE_ON_START: '0' }), false);
  assert.equal(autoMigrateEnabled({ ...prod, DEMO_MODE: '1', DB_MIGRATE_ON_START: '0' }), false);
});

test('Vercel без DATABASE_URL — демо, миграции идут', () => {
  assert.equal(autoMigrateEnabled({ NODE_ENV: 'production', VERCEL: '1' }), true);
  assert.equal(autoMigrateEnabled({ NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: 'postgres://x' }), false);
});

test('production без DATABASE_URL и без демо: миграции не идут (приложение всё равно не стартует)', () => {
  assert.equal(autoMigrateEnabled({ NODE_ENV: 'production' }), false);
});
