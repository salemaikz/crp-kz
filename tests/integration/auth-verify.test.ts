// Подтверждение email: sendVerification, verifyEmail, resendVerification на БД и server actions в
// отдельном процессе (сценарии «verify: …» из fixtures/auth-recovery.flow.ts).
// Регистрация при флаге (3A) проверяется сценариями fixtures/auth-actions.flow.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resendVerification, sendVerification, verifyEmail } from '../../src/lib/auth/recovery';
import { issueToken, TOKEN_TTL_MS } from '../../src/lib/auth/tokens';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = 1_800_000_000_000;
const MIN = 60_000;

let db: TestDb;

before(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await db.sql`DELETE FROM auth_tokens`;
  await db.sql`DELETE FROM audit_log WHERE entity_id LIKE 'ver-%'`;
  await db.sql`DELETE FROM users WHERE id LIKE 'ver-%'`;
  await db.sql`INSERT INTO users (id, email, name, locale, created_at) VALUES ('ver-1', 'ver1@x.kz', 'Айгерим', 'kz', 1)`;
});
after(async () => {
  await db.close();
});

const send = (next?: string | null, nowMs = T0) =>
  db.tx((sql) => sendVerification(sql, { userId: 'ver-1', email: 'ver1@x.kz', name: 'Айгерим', locale: 'kz', next, nowMs }));
const secret = async () => {
  const [m] = await db.sql<{ secret: string }>`
    SELECT secret FROM mail_outbox WHERE template = 'email_verify' AND secret IS NOT NULL ORDER BY created_at DESC, id LIMIT 1`;
  assert.ok(m);
  return m.secret;
};

test('sendVerification: письмо со ссылкой, безопасный next в параметрах, журнал без email', async () => {
  const res = await send('/kz/courses/x/buy');
  assert.ok(res.queued);
  const [m] = await db.sql<{ template: string; locale: string; params: { name: string; next: string | null }; status: string }>`
    SELECT template, locale, params, status FROM mail_outbox`;
  assert.equal(m?.template, 'email_verify');
  assert.equal(m?.locale, 'kz');
  assert.equal(m?.params.next, '/kz/courses/x/buy');
  assert.ok(!JSON.stringify(m?.params).includes(await secret()), 'токена в параметрах нет');
  const audit = await db.sql<{ action: string; actorId: string }>`SELECT action, actor_id FROM audit_log WHERE entity_id = 'ver-1'`;
  assert.deepEqual(audit.map((a) => [a.action, a.actorId]), [['user.email_verify_request', 'ver-1']]);
  assert.ok(!JSON.stringify(audit).includes('@'));

  await send('https://evil.example/x', T0 + MIN);
  const rows = await db.sql<{ params: { next: string | null } }>`SELECT params FROM mail_outbox ORDER BY created_at`;
  assert.equal(rows[1]?.params.next, null, 'чужой адрес отброшен');

  // query и фрагмент (например, ключ заказа ?key=…) в параметры письма не попадают
  await send('/ru/orders/CRP-1?key=SECRETKEY#top', T0 + 2 * MIN);
  const all = await db.sql<{ params: { next: string | null } }>`SELECT params FROM mail_outbox ORDER BY created_at`;
  assert.equal(all[2]?.params.next, '/ru/orders/CRP-1');
  assert.ok(!JSON.stringify(all).includes('SECRETKEY'));
});

test('verifyEmail: подтверждает, повтор, истёкший и чужой вид токена — invalid_token', async () => {
  await send();
  const token = await secret();
  assert.deepEqual(await verifyEmail({ token, nowMs: T0 + TOKEN_TTL_MS.email_verify }), { ok: false, reason: 'invalid_token' }, 'через 3 дня ссылка мертва');
  assert.deepEqual(await verifyEmail({ token, nowMs: T0 + MIN }), { ok: true, userId: 'ver-1' });
  const [u] = await db.sql<{ emailVerifiedAt: number }>`SELECT email_verified_at FROM users WHERE id = 'ver-1'`;
  assert.equal(u?.emailVerifiedAt, T0 + MIN);
  assert.deepEqual(await verifyEmail({ token, nowMs: T0 + 2 * MIN }), { ok: false, reason: 'invalid_token' });

  const reset = await db.tx((sql) => issueToken(sql, { userId: 'ver-1', email: 'ver1@x.kz', kind: 'password_reset', nowMs: T0 }));
  assert.ok(reset);
  assert.deepEqual(await verifyEmail({ token: reset.raw, nowMs: T0 + MIN }), { ok: false, reason: 'invalid_token' }, 'токен сброса не подтверждает email');
  const audit = await db.sql<{ action: string }>`SELECT action FROM audit_log WHERE entity_id = 'ver-1' AND action = 'user.email_verify'`;
  assert.equal(audit.length, 1);
});

test('verifyEmail: email сменили после выдачи — ссылка недействительна', async () => {
  await send();
  const token = await secret();
  await db.sql`UPDATE users SET email = 'moved@x.kz' WHERE id = 'ver-1'`;
  assert.deepEqual(await verifyEmail({ token, nowMs: T0 + MIN }), { ok: false, reason: 'invalid_token' });
  const [u] = await db.sql<{ emailVerifiedAt: number | null }>`SELECT email_verified_at FROM users WHERE id = 'ver-1'`;
  assert.equal(u?.emailVerifiedAt, null);
});

test('resendVerification: лимит писем откатывает транзакцию, прежняя ссылка жива; подтверждённому письмо не нужно', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await resendVerification({ userId: 'ver-1', locale: 'ru', nowMs: T0 + i * 1000 });
    assert.deepEqual(r, { ok: true, email: 'ver1@x.kz' });
  }
  const fifth = await secret();
  assert.deepEqual(await resendVerification({ userId: 'ver-1', locale: 'ru', nowMs: T0 + 6000 }), { ok: false, reason: 'rate_limited' });
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
  assert.equal(n?.n, 5, 'шестое письмо не поставлено');
  assert.deepEqual(await verifyEmail({ token: fifth, nowMs: T0 + 7000 }), { ok: true, userId: 'ver-1' }, 'пятая ссылка рабочая');
  assert.deepEqual(await resendVerification({ userId: 'ver-1', locale: 'ru', nowMs: T0 + 8000 }), { ok: false, reason: 'already_verified' });
  assert.deepEqual(await resendVerification({ userId: 'nope', locale: 'ru', nowMs: T0 }), { ok: false, reason: 'not_found' });
});

test('server actions подтверждения email: вход не выполняется, лимиты, loggedIn, флаг', () => {
  const env = { ...process.env };
  for (const k of ['DATABASE_URL', 'SESSION_SECRET', 'TEST_DATABASE_URL', 'DEMO_MODE', 'TRUST_X_REAL_IP', 'NODE_TEST_CONTEXT']) delete env[k];
  env.TRUSTED_PROXY_HOPS = '1';
  const res = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks', '--no-warnings', '--import', 'tsx', '--test',
      '--test-name-pattern=^verify:', path.join(here, 'fixtures/auth-recovery.flow.ts'),
    ],
    { env, encoding: 'utf8', timeout: 180_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 4\b/);
  assert.match(res.stdout, /# fail 0\b/);
});

test('регистрация: письмо подтверждения в транзакции при флаге; без флага письма нет; лимит писем не откатывает регистрацию', () => {
  // сценарии registerAction живут в fixtures/auth-actions.flow.ts (там же подмена next/headers)
  const env = { ...process.env };
  for (const k of ['DATABASE_URL', 'SESSION_SECRET', 'TEST_DATABASE_URL', 'DEMO_MODE', 'TRUST_X_REAL_IP', 'NODE_TEST_CONTEXT']) delete env[k];
  env.TRUSTED_PROXY_HOPS = '1';
  const res = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks', '--no-warnings', '--import', 'tsx', '--test',
      '--test-name-pattern=^register: (письмо подтверждения|лимит писем)', path.join(here, 'fixtures/auth-actions.flow.ts'),
    ],
    { env, encoding: 'utf8', timeout: 180_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 2\b/);
  assert.match(res.stdout, /# fail 0\b/);
});
