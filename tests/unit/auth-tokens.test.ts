// Токены ссылок: форма, хеш, проверка формы.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateToken, hashToken, isTokenShape, TOKEN_TTL_MS } from '../../src/lib/auth/tokens';

test('generateToken: 43 знака base64url и хеш из 64 hex, токены разные', () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a.raw, /^[A-Za-z0-9_-]{43}$/);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.hash, hashToken(a.raw));
  assert.notEqual(a.raw, b.raw);
  assert.notEqual(a.hash, b.hash);
});

test('hashToken: детерминирован и совпадает со SHA-256', () => {
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), hashToken('abd'));
});

test('isTokenShape: ровно 43 знака алфавита base64url', () => {
  assert.equal(isTokenShape(generateToken().raw), true);
  assert.equal(isTokenShape('A'.repeat(43)), true);
  assert.equal(isTokenShape('A'.repeat(42)), false);
  assert.equal(isTokenShape('A'.repeat(44)), false);
  for (const bad of ['+', '/', '=', ' ', '.', '\n']) assert.equal(isTokenShape('A'.repeat(42) + bad), false, JSON.stringify(bad));
  for (const bad of [null, undefined, 42, {}, [], ['A'.repeat(43)]]) assert.equal(isTokenShape(bad), false);
});

test('срок жизни: сброс пароля 1 час, подтверждение email 3 дня', () => {
  assert.equal(TOKEN_TTL_MS.password_reset, 3_600_000);
  assert.equal(TOKEN_TTL_MS.email_verify, 3 * 24 * 3_600_000);
});
