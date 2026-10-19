import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { seedId } from '../../src/lib/content/ids';
import {
  createSessionToken,
  isSeedUser,
  resolveSessionToken,
  revokeSessionToken,
  SESSION_TTL_MS,
} from '../../src/lib/auth/session';
import { signSession } from '../../src/lib/auth/token';
import { sessionSecret } from '../../src/lib/env';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

const SEED_EMAIL = 'operator@crp.demo';
const SEED_UID = seedId('user', SEED_EMAIL);
let db: TestDb;

const saved = { url: process.env.DATABASE_URL, secret: process.env.SESSION_SECRET, demo: process.env.DEMO_MODE };
function restoreEnv() {
  if (saved.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.url;
  if (saved.secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved.secret;
  if (saved.demo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = saved.demo;
}

before(async () => {
  restoreEnv();
  delete process.env.DATABASE_URL; // демо-режим; getDb() уже подменён тестовой БД
  delete process.env.DEMO_MODE;
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, role, locale, created_at) VALUES
    (${SEED_UID}, ${SEED_EMAIL}, 'Оператор', 'learner', 'ru', 1),
    ('plain-user', 'plain@x.kz', 'Обычный', 'admin', 'kz', 1)`;
});
afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.DEMO_MODE;
});
after(async () => {
  restoreEnv();
  await db.close();
});

test('isSeedUser: id совпадает с seedId(email)', () => {
  assert.equal(isSeedUser({ id: SEED_UID, email: SEED_EMAIL }), true);
  assert.equal(isSeedUser({ id: 'plain-user', email: 'plain@x.kz' }), false);
});

test('сессия: создание, проверка, отзыв', async () => {
  const { token, expiresAt } = await createSessionToken('plain-user');
  assert.ok(expiresAt > Date.now() + SESSION_TTL_MS - 60_000);
  assert.deepEqual(await resolveSessionToken(token), {
    id: 'plain-user',
    email: 'plain@x.kz',
    name: 'Обычный',
    role: 'admin',
    locale: 'kz',
    emailVerified: false,
  });
  await revokeSessionToken(token);
  assert.equal(await resolveSessionToken(token), null); // не пользователь сида — не восстанавливается
});

test('подделка и истёкшая строка — отказ', async () => {
  const { token } = await createSessionToken('plain-user');
  assert.equal(await resolveSessionToken(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(await resolveSessionToken('garbage'), null);
  assert.equal(await resolveSessionToken(undefined), null);
  await db.sql`UPDATE sessions SET expires_at = ${Date.now() - 1} WHERE user_id = 'plain-user'`;
  assert.equal(await resolveSessionToken(token), null);
});

test('чужой uid в подписанном токене при существующей строке — отказ', async () => {
  await createSessionToken('plain-user');
  const [row] = await db.sql<{ id: string }>`
    SELECT id FROM sessions WHERE user_id = 'plain-user' ORDER BY created_at DESC LIMIT 1`;
  const sid = row?.id ?? '';
  const forged = signSession({ sid, uid: SEED_UID, exp: Date.now() + 60_000 }, sessionSecret());
  assert.equal(await resolveSessionToken(forged), null);
});

test('демо: строки нет, подпись верна, пользователь сида — сессия создаётся заново', async () => {
  const sid = 'lost-session-' + Math.random();
  const token = signSession({ sid, uid: SEED_UID, exp: Date.now() + 60_000 }, sessionSecret());
  const user = await resolveSessionToken(token);
  assert.equal(user?.id, SEED_UID);
  const rows = await db.sql`SELECT id FROM sessions WHERE id = ${sid}`;
  assert.equal(rows.length, 1);
  assert.equal((await resolveSessionToken(token))?.id, SEED_UID); // второй раз — по строке
});

test('демо: срок восстановленной строки — не дальше SESSION_TTL от «сейчас»', async () => {
  const sid = 'lost-long-' + Math.random();
  const token = signSession({ sid, uid: SEED_UID, exp: Date.now() + 10 * SESSION_TTL_MS }, sessionSecret());
  assert.equal((await resolveSessionToken(token))?.id, SEED_UID);
  const [row] = await db.sql<{ expiresAt: number }>`SELECT expires_at FROM sessions WHERE id = ${sid}`;
  assert.ok(row && row.expiresAt <= Date.now() + SESSION_TTL_MS && row.expiresAt > Date.now() + SESSION_TTL_MS - 60_000);
});

test('демо: зарегистрированный (не из сида) пользователь без строки сессии — отказ', async () => {
  const sid = 'lost-plain-' + Math.random();
  const token = signSession({ sid, uid: 'plain-user', exp: Date.now() + 60_000 }, sessionSecret());
  assert.equal(await resolveSessionToken(token), null);
  assert.equal((await db.sql`SELECT id FROM sessions WHERE id = ${sid}`).length, 0);
});

test('не демо: без строки сессии — отказ даже для пользователя сида', async () => {
  process.env.DATABASE_URL = 'postgres://unused/db'; // только переключает isDemo(); БД остаётся тестовой
  process.env.SESSION_SECRET = 'prod-like-secret-'.padEnd(48, 'z');
  const token = signSession({ sid: 'missing-sid', uid: SEED_UID, exp: Date.now() + 60_000 }, sessionSecret());
  assert.equal(await resolveSessionToken(token), null);
  const rows = await db.sql`SELECT id FROM sessions WHERE id = 'missing-sid'`;
  assert.equal(rows.length, 0);
});

test('не демо без SESSION_SECRET — создание сессии невозможно', async () => {
  process.env.DATABASE_URL = 'postgres://unused/db';
  await assert.rejects(createSessionToken('plain-user'), /SESSION_SECRET/);
});

test('DEMO_MODE=1 на настоящем Postgres: демо-секрет не используется', async () => {
  process.env.DATABASE_URL = 'postgres://unused/db';
  process.env.DEMO_MODE = '1';
  await assert.rejects(createSessionToken('plain-user'), /SESSION_SECRET/);
});
