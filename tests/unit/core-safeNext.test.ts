import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeNext } from '../../src/lib/auth/safeNext';

test('safeNext: относительные пути проходят', () => {
  assert.equal(safeNext('/ru/learn'), '/ru/learn');
  assert.equal(safeNext('/kz/learn/tselina/intro?x=1#q'), '/kz/learn/tselina/intro?x=1#q');
  assert.equal(safeNext('/ru/a/../learn'), '/ru/learn');
  assert.equal(safeNext('/'), '/');
});

test('safeNext: внешние и подозрительные адреса отклоняются', () => {
  for (const bad of [
    'https://evil.com',
    'http://evil.com/ru',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    ' /ru/learn',
    'javascript:alert(1)',
    'ru/learn',
    '',
    '/' + 'a'.repeat(3000),
  ]) {
    assert.equal(safeNext(bad), null, bad);
  }
  assert.equal(safeNext(null), null);
  assert.equal(safeNext(undefined), null);
  assert.equal(safeNext(42), null);
});

test('safeNext: нормализация не уводит на другой хост', () => {
  const out = safeNext('/..//evil.com');
  assert.ok(out === null || (out.startsWith('/') && !out.startsWith('//')), String(out));
});
