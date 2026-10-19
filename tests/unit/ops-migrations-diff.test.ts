// diffMigrations: чистое сравнение списков миграций на диске и в schema_migrations.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffMigrations } from '../../src/lib/db/migrate';

test('пусто и пусто', () => {
  assert.deepEqual(diffMigrations([], []), { files: [], applied: [], pending: [], unknown: [] });
});

test('всё накатано', () => {
  const r = diffMigrations(['b.sql', 'a.sql'], ['a.sql', 'b.sql']);
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.files, ['a.sql', 'b.sql'], 'отсортировано');
});

test('pending в середине алфавита', () => {
  const r = diffMigrations(['a.sql', 'b.sql', 'c.sql'], ['a.sql', 'c.sql']);
  assert.deepEqual(r.pending, ['b.sql']);
  assert.deepEqual(r.unknown, []);
});

test('unknown: БД новее кода', () => {
  const r = diffMigrations(['a.sql'], ['a.sql', 'z.sql']);
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.unknown, ['z.sql']);
});

test('дубликаты не размножаются', () => {
  const r = diffMigrations(['a.sql', 'a.sql', 'b.sql'], ['a.sql', 'a.sql']);
  assert.deepEqual(r.files, ['a.sql', 'b.sql']);
  assert.deepEqual(r.applied, ['a.sql']);
  assert.deepEqual(r.pending, ['b.sql']);
});

test('входные массивы не меняются', () => {
  const files = ['b.sql', 'a.sql'];
  diffMigrations(files, []);
  assert.deepEqual(files, ['b.sql', 'a.sql']);
});
