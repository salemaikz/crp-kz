import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { passwordProblem, verifyPassword, hashPassword } from '../../src/lib/auth/password';
import {
  AUTH_LIMITS,
  evictRateLimitKeys,
  rateLimit,
  rateLimitSize,
  resetRateLimit,
} from '../../src/lib/auth/rateLimit';
import { assertDbConfigured, isDemo, sessionSecret } from '../../src/lib/env';

const ENV_KEYS = ['DATABASE_URL', 'SESSION_SECRET', 'DEMO_MODE', 'NODE_ENV'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setEnv(k: (typeof ENV_KEYS)[number], v: string | undefined) {
  // NODE_ENV в типах Next — readonly; в тестах переключаем его через индекс
  const env = process.env as Record<string, string | undefined>;
  if (v === undefined) delete env[k];
  else env[k] = v;
}
afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
});

test('env: демо без DATABASE_URL, секрет обязателен вне демо', () => {
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.DEMO_MODE;
  setEnv('NODE_ENV', 'development');
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

test('env: демо только явно; production без DATABASE_URL и DEMO_MODE — отказ при инициализации БД', () => {
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_MODE;
  delete process.env.SESSION_SECRET;
  setEnv('NODE_ENV', 'production');
  assert.equal(isDemo(), false);
  assert.throws(() => assertDbConfigured(), /DATABASE_URL is not set in production/);
  assert.throws(() => sessionSecret(), /SESSION_SECRET/);
  process.env.DEMO_MODE = '1'; // превью на Vercel
  assert.equal(isDemo(), true);
  assert.doesNotThrow(() => assertDbConfigured());
  assert.ok(sessionSecret().length >= 32);
  process.env.DEMO_MODE = 'true'; // только '1'
  assert.equal(isDemo(), false);
  delete process.env.DEMO_MODE;
  process.env.DATABASE_URL = 'postgres://example/db';
  assert.doesNotThrow(() => assertDbConfigured());
  assert.equal(isDemo(), false);
  setEnv('NODE_ENV', 'development');
  delete process.env.DATABASE_URL;
  assert.doesNotThrow(() => assertDbConfigured());
  assert.equal(isDemo(), true);
});

test('env: короткий SESSION_SECRET — ошибка и в демо', () => {
  delete process.env.DATABASE_URL;
  process.env.DEMO_MODE = '1';
  process.env.SESSION_SECRET = 'short-secret';
  assert.equal(isDemo(), true);
  assert.throws(() => sessionSecret(), /shorter than 32/);
  // демо на настоящем Postgres — демо-секрет не подставляется
  delete process.env.SESSION_SECRET;
  process.env.DATABASE_URL = 'postgres://example/db';
  assert.equal(isDemo(), true);
  assert.throws(() => sessionSecret(), /SESSION_SECRET/);
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

test('rateLimit: лимит на email не зависит от IP', () => {
  const email = `victim-${Math.random()}@x.kz`;
  const { limit, windowMs } = AUTH_LIMITS.loginPerEmail;
  const t0 = 5_000_000;
  for (let i = 0; i < limit; i++) {
    // каждый раз «новый IP»: лимит по IP+email не срабатывает, по email — копится
    assert.equal(rateLimit(`login:10.0.${i}.1:${email}`, AUTH_LIMITS.loginPerIpEmail.limit, windowMs, t0 + i).ok, true);
    assert.equal(rateLimit(`login-email:${email}`, limit, windowMs, t0 + i).ok, true);
  }
  assert.equal(rateLimit(`login-email:${email}`, limit, windowMs, t0 + limit).ok, false);
  assert.equal(rateLimit(`login-email:${email}`, limit, windowMs, t0 + windowMs + 1).ok, true);
});

test('rateLimit: вытеснение при переполнении щадит ключи с большим числом попыток', () => {
  const p = `evict-${Math.random()}:`;
  const t0 = 9_000_000;
  for (let i = 0; i < 5; i++) rateLimit(`${p}hot`, 100, 60_000, t0 + i); // перебор: 5 попыток
  for (let i = 0; i < 200; i++) rateLimit(`${p}cold${i}`, 100, 60_000, t0 + 10 + i); // «флуд» новыми ключами
  rateLimit(`${p}expired`, 100, 1_000, t0 - 10_000); // окно истекло
  const before = rateLimitSize();
  evictRateLimitKeys(before - 150, t0 + 1000);
  assert.ok(rateLimitSize() <= before - 150);
  // горячий ключ на месте: счётчик не сброшен
  let blocked = 0;
  for (let i = 0; i < 6; i++) if (!rateLimit(`${p}hot`, 6, 60_000, t0 + 2000 + i).ok) blocked++;
  assert.equal(blocked, 5, 'осталась одна попытка из 6 — счётчик не сброшен');
});
