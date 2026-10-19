import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { signSession, verifySession } from '../../src/lib/auth/token';

const SECRET = 'test-secret-'.padEnd(40, 'x');
const NOW = 1_800_000_000_000;
const payload = { sid: 'sid-1', uid: 'user-1', exp: NOW + 60_000 };

test('подпись и проверка токена', () => {
  const token = signSession(payload, SECRET);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(verifySession(token, SECRET, NOW), payload);
});

test('чужой секрет, подмена данных или подписи — отказ', () => {
  const token = signSession(payload, SECRET);
  assert.equal(verifySession(token, SECRET + 'y', NOW), null);
  const [body, sig] = token.split('.') as [string, string];
  const forged = Buffer.from(JSON.stringify({ ...payload, uid: 'admin' })).toString('base64url');
  assert.equal(verifySession(`${forged}.${sig}`, SECRET, NOW), null);
  const flipped = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
  assert.equal(verifySession(`${body}.${flipped}`, SECRET, NOW), null);
  assert.equal(verifySession(`${body}.${sig}x`, SECRET, NOW), null);
});

test('истёкший токен — отказ', () => {
  const token = signSession({ ...payload, exp: NOW - 1 }, SECRET);
  assert.equal(verifySession(token, SECRET, NOW), null);
  assert.equal(verifySession(signSession({ ...payload, exp: NOW }, SECRET), SECRET, NOW), null);
});

test('мусор и неверная структура — отказ', () => {
  for (const bad of ['', 'abc', 'a.b', '.', 'a'.repeat(5000) + '.' + 'b'.repeat(43), null, undefined]) {
    assert.equal(verifySession(bad as string, SECRET, NOW), null);
  }
  // подписанный, но с неправильными типами полей
  const body = Buffer.from(JSON.stringify({ sid: 1, uid: 'u', exp: NOW + 1000 })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  assert.equal(verifySession(`${body}.${sig}`, SECRET, NOW), null);
});
