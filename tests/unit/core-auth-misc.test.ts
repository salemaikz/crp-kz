import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { passwordProblem, verifyPassword, hashPassword } from '../../src/lib/auth/password';
import { rateLimit, resetRateLimit } from '../../src/lib/auth/rateLimit';
import { isDemo, sessionSecret } from '../../src/lib/env';

const saved = { url: process.env.DATABASE_URL, secret: process.env.SESSION_SECRET };
afterEach(() => {
  if (saved.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.url;
  if (saved.secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved.secret;
});

test('env: демо без DATABASE_URL, секрет обязателен вне демо', () => {
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  assert.equal(isDemo(), true);
  assert.ok(sessionSecret().length >= 32);
  process.env.DATABASE_URL = 'postgres://example/db';
  assert.equal(isDemo(), false);
  assert.throws(() => sessionSecret());
  process.env.SESSION_SECRET = 'short';
  assert.throws(() => sessionSecret());
  process.env.SESSION_SECRET = 's'.repeat(32);
  assert.equal(sessionSecret(), 's'.repeat(32));
});

test('пароль: минимум 8 символов, не длиннее 72 байт', () => {
  assert.equal(passwordProblem('1234567'), 'weak_password');
  assert.equal(passwordProblem('12345678'), null);
  assert.equal(passwordProblem('я'.repeat(40)), 'validation');
});

test('пароль: bcrypt cost 10, сверка; без хеша — всегда false', async () => {
  const hash = await hashPassword('demo12345');
  assert.match(hash, /^\$2[aby]\$10\$/);
  assert.equal(await verifyPassword('demo12345', hash), true);
  assert.equal(await verifyPassword('demo12346', hash), false);
  assert.equal(await verifyPassword('demo12345', null), false);
  assert.equal(await verifyPassword('demo12345', 'not-a-hash'), false);
});

test('rateLimit: скользящее окно', () => {
  const key = 'test:' + Math.random();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, 3, 1000, t0 + i).ok, true);
  const blocked = rateLimit(key, 3, 1000, t0 + 10);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 1000);
  assert.equal(rateLimit(key, 3, 1000, t0 + 1001).ok, true); // первая попытка вышла из окна
  resetRateLimit(key);
  assert.equal(rateLimit(key, 1, 1000, t0 + 1002).ok, true);
});
