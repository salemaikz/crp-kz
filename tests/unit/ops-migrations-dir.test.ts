// MIGRATIONS_DIR: в production — понятная ошибка, вне production — подмена каталога.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { migrationsDir } from '../../src/lib/db/migrate';

const env = process.env as Record<string, string | undefined>;
const saved = { dir: env.MIGRATIONS_DIR, node: env.NODE_ENV };
function restore(k: string, v: string | undefined) {
  if (v === undefined) delete env[k];
  else env[k] = v;
}
afterEach(() => {
  restore('MIGRATIONS_DIR', saved.dir);
  restore('NODE_ENV', saved.node);
});

test('migrationsDir: в production заданный MIGRATIONS_DIR — ошибка', () => {
  env.NODE_ENV = 'production';
  env.MIGRATIONS_DIR = '/srv/crp/migrations';
  assert.throws(() => migrationsDir(), /MIGRATIONS_DIR.*production/);
});

test('migrationsDir: в production без переменной — ./migrations', () => {
  env.NODE_ENV = 'production';
  delete env.MIGRATIONS_DIR;
  assert.equal(migrationsDir(), path.join(process.cwd(), 'migrations'));
});

test('migrationsDir: вне production переменная подменяет каталог', () => {
  env.NODE_ENV = 'test';
  env.MIGRATIONS_DIR = '/tmp/x';
  assert.equal(migrationsDir(), '/tmp/x');
});
