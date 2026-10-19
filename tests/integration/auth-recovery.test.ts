// Сброс пароля: логика recovery.ts на БД и server actions в отдельном процессе (подмена next/headers).
// Блокировки токенов (users, затем auth_tokens) и лимиты писем проверяются здесь же: на Postgres
// (TEST_DATABASE_URL) параллельные транзакции настоящие, на PGlite они идут по очереди.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSessionToken, resolveSessionToken } from '../../src/lib/auth/session';
import { hashPassword, verifyPassword } from '../../src/lib/auth/password';
import { requestPasswordReset, resetPassword } from '../../src/lib/auth/recovery';
import { consumeToken, issueToken, TOKEN_TTL_MS } from '../../src/lib/auth/tokens';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { seedId } from '../../src/lib/content/ids';
import { enqueueMail } from '../../src/lib/mail/outbox';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = 1_800_000_000_000;
const MIN = 60_000;

let db: TestDb;
let oldHash: string;
const saved: Record<string, string | undefined> = {};
const KEYS = ['FEATURE_PASSWORD_RESET', 'MAIL_AUTH_HOURLY_CAP'];

before(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  db = await createTestDb();
  oldHash = await hashPassword('old-password-1');
});
beforeEach(async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await db.sql`DELETE FROM auth_tokens`;
  await db.sql`DELETE FROM sessions WHERE user_id LIKE 'rec-%'`;
  await db.sql`DELETE FROM audit_log WHERE entity_id LIKE 'rec-%'`;
  await db.sql`DELETE FROM users WHERE id LIKE 'rec-%'`;
  await db.sql`INSERT INTO users (id, email, password_hash, name, locale, created_at)
    VALUES ('rec-1', 'rec1@x.kz', ${oldHash}, 'Айгерим', 'kz', 1), ('rec-2', 'rec2@x.kz', ${oldHash}, 'Второй', 'ru', 1)`;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
after(async () => {
  await db.close();
});

type MailRow = { id: string; template: string; status: string; secret: string | null; toEmail: string; locale: string };
const mails = () => db.sql<MailRow>`SELECT id, template, status, secret, to_email, locale FROM mail_outbox ORDER BY created_at, id`;
const liveSecret = async (template: string) => {
  const [m] = await db.sql<{ secret: string }>`
    SELECT secret FROM mail_outbox WHERE template = ${template} AND secret IS NOT NULL ORDER BY created_at DESC, id LIMIT 1`;
  assert.ok(m, `нет письма ${template} с секретом`);
  return m.secret;
};
const counts = async () => {
  const [a] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM auth_tokens`;
  const [m] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
  return { tokens: a?.n, mails: m?.n };
};

test('запрос: неизвестный email и аккаунт сида в демо — ничего не пишут', async () => {
  await requestPasswordReset({ email: 'nobody@x.kz', locale: 'ru', nowMs: T0 });
  assert.deepEqual(await counts(), { tokens: 0, mails: 0 });
  // сид-аккаунт: сессии демо восстанавливаются по подписи, пароль общий — сброс молча не выполняется
  const [seed] = await db.sql<{ id: string }>`SELECT id FROM users WHERE id = ${seedId('user', 'client@crp.demo')}`;
  if (seed) {
    await requestPasswordReset({ email: 'client@crp.demo', locale: 'ru', nowMs: T0 });
    assert.deepEqual(await counts(), { tokens: 0, mails: 0 });
  }
});

test('запрос: известный email — токен, письмо на языке формы, журнал без email', async () => {
  await requestPasswordReset({ email: ' Rec1@X.kz ', locale: 'kz', nowMs: T0 });
  const rows = await mails();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.template, 'password_reset');
  assert.equal(rows[0]?.toEmail, 'rec1@x.kz');
  assert.equal(rows[0]?.locale, 'kz');
  const audit = await db.sql<{ action: string; actorId: string | null; meta: unknown }>`
    SELECT action, actor_id, meta FROM audit_log WHERE entity_id = 'rec-1'`;
  assert.deepEqual(audit.map((a) => [a.action, a.actorId]), [['user.password_reset_request', null]]);
  assert.ok(!JSON.stringify(audit).includes('@'), 'в журнале нет email');
});

test('запрос: второй гасит первый токен, письмо первого — cancelled', async () => {
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 });
  const first = await liveSecret('password_reset');
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 + MIN });
  const rows = await mails();
  assert.deepEqual(rows.map((r) => r.status), ['cancelled', 'held']);
  assert.equal(rows[0]?.secret, null);
  const r = await resetPassword({ token: first, passwordHash: 'x', nowMs: T0 + 2 * MIN });
  assert.deepEqual(r, { ok: false, reason: 'invalid_token' });
});

test('запрос: флаг выключен — в БД ничего не пишется', async () => {
  process.env.FEATURE_PASSWORD_RESET = '0';
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 });
  assert.deepEqual(await counts(), { tokens: 0, mails: 0 });
});

test('сброс: пароль, подтверждение email, закрытие сессий, письмо и журнал', async () => {
  const other = await createSessionToken('rec-1');
  assert.equal((await resolveSessionToken(other.token))?.id, 'rec-1');
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 });
  const token = await liveSecret('password_reset');
  const newHash = await hashPassword('new-password-1');

  const ok = await resetPassword({ token, passwordHash: newHash, nowMs: T0 + MIN });
  assert.deepEqual(ok, { ok: true, userId: 'rec-1' });

  const [u] = await db.sql<{ passwordHash: string; emailVerifiedAt: number | null }>`
    SELECT password_hash, email_verified_at FROM users WHERE id = 'rec-1'`;
  assert.equal(await verifyPassword('new-password-1', u?.passwordHash), true);
  assert.equal(await verifyPassword('old-password-1', u?.passwordHash), false);
  assert.equal(u?.emailVerifiedAt, T0 + MIN, 'владение почтой доказано');
  assert.equal(await resolveSessionToken(other.token), null, 'прочие сессии закрыты');

  const rows = await mails();
  const changed = rows.find((r) => r.template === 'password_changed');
  assert.ok(changed, 'письмо о смене пароля в очереди');
  assert.equal(changed.locale, 'kz', 'язык письма — язык аккаунта');
  assert.equal(rows.find((r) => r.template === 'password_reset')?.secret, null, 'секрет ссылки не остался');
  const audit = await db.sql<{ action: string; actorId: string | null }>`
    SELECT action, actor_id FROM audit_log WHERE entity_id = 'rec-1' ORDER BY created_at, id`;
  assert.ok(audit.some((a) => a.action === 'user.password_reset' && a.actorId === 'rec-1'));

  // повторно и после смены — ссылка мертва
  assert.deepEqual(await resetPassword({ token, passwordHash: newHash, nowMs: T0 + 2 * MIN }), { ok: false, reason: 'invalid_token' });
});

test('сброс: подтверждённая дата email не затирается', async () => {
  await db.sql`UPDATE users SET email_verified_at = 777 WHERE id = 'rec-1'`;
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 });
  await resetPassword({ token: await liveSecret('password_reset'), passwordHash: oldHash, nowMs: T0 + MIN });
  const [u] = await db.sql<{ emailVerifiedAt: number }>`SELECT email_verified_at FROM users WHERE id = 'rec-1'`;
  assert.equal(u?.emailVerifiedAt, 777);
});

test('сброс: истёкший токен и токен другого вида — invalid_token, ничего не меняется', async () => {
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 });
  const token = await liveSecret('password_reset');
  const late = await resetPassword({ token, passwordHash: 'x', nowMs: T0 + TOKEN_TTL_MS.password_reset + MIN });
  assert.deepEqual(late, { ok: false, reason: 'invalid_token' });

  const verify = await db.tx(async (sql) => {
    const s = await issueToken(sql, { userId: 'rec-2', email: 'rec2@x.kz', kind: 'email_verify', nowMs: T0 });
    assert.ok(s);
    return s;
  });
  assert.deepEqual(await resetPassword({ token: verify.raw, passwordHash: 'x', nowMs: T0 + MIN }), { ok: false, reason: 'invalid_token' });
  const [u] = await db.sql<{ passwordHash: string; emailVerifiedAt: number | null }>`
    SELECT password_hash, email_verified_at FROM users WHERE id = 'rec-2'`;
  assert.equal(u?.passwordHash, oldHash);
  assert.equal(u?.emailVerifiedAt, null);
  const [t] = await db.sql<{ usedAt: number | null }>`SELECT used_at FROM auth_tokens WHERE user_id = 'rec-2'`;
  assert.equal(t?.usedAt, null, 'токен другого вида не израсходован');
});

test('сброс: email сменили после выдачи — ссылка недействительна и не расходуется', async () => {
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 });
  const token = await liveSecret('password_reset');
  await db.sql`UPDATE users SET email = 'moved@x.kz' WHERE id = 'rec-1'`;
  assert.deepEqual(await resetPassword({ token, passwordHash: 'x', nowMs: T0 + MIN }), { ok: false, reason: 'invalid_token' });
  const [t] = await db.sql<{ usedAt: number | null }>`SELECT used_at FROM auth_tokens WHERE user_id = 'rec-1'`;
  assert.equal(t?.usedAt, null);
});

test('5 запросов сброса, затем смена пароля: password_changed в очереди, лимит ссылок держится', async () => {
  for (let i = 0; i < 5; i++) await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 + i * 1000 });
  const before6 = await counts();
  assert.equal(before6.mails, 5);

  // шестой запрос: лимит получателя, молча; пятая ссылка жива и ничего не погашено
  await requestPasswordReset({ email: 'rec1@x.kz', locale: 'ru', nowMs: T0 + 6000 });
  assert.deepEqual(await counts(), before6);
  const token = await liveSecret('password_reset');
  assert.deepEqual(await resetPassword({ token, passwordHash: oldHash, nowMs: T0 + 7000 }), { ok: true, userId: 'rec-1' });

  const changed = (await mails()).filter((m) => m.template === 'password_changed');
  assert.equal(changed.length, 1, 'уведомление о смене пароля не съедено лимитом');
  assert.equal(changed[0]?.status, 'held');
});

test('лимит получателя считает только письма со ссылкой, предохранитель — все письма auth', async () => {
  for (let i = 0; i < 6; i++) {
    const r = await enqueueMail(db.sql, {
      template: 'password_changed',
      locale: 'ru',
      to: 'rec2@x.kz',
      userId: 'rec-2',
      params: { name: 'Второй', changedAt: T0 },
      nowMs: T0 + i,
    });
    assert.ok(r.queued, `password_changed №${i + 1}`);
  }
  // а письма со ссылкой по-прежнему режутся на пятом
  for (let i = 0; i < 5; i++) {
    const r = await enqueueMail(db.sql, {
      template: 'email_verify', locale: 'ru', to: 'rec2@x.kz', userId: 'rec-2', params: { name: 'Второй' },
      secret: { raw: 'A'.repeat(43), expiresAt: T0 + 3_600_000 }, nowMs: T0 + 100 + i,
    });
    assert.ok(r.queued);
  }
  const sixth = await enqueueMail(db.sql, {
    template: 'password_reset', locale: 'ru', to: 'rec2@x.kz', userId: 'rec-2', params: { name: 'Второй' },
    secret: { raw: 'B'.repeat(43), expiresAt: T0 + 3_600_000 }, nowMs: T0 + 200,
  });
  assert.deepEqual(sixth, { queued: false, reason: 'recipient_cap' });

  process.env.MAIL_AUTH_HOURLY_CAP = '3';
  const notice = await enqueueMail(db.sql, {
    template: 'password_changed', locale: 'ru', to: 'rec1@x.kz', userId: 'rec-1', params: { name: 'Первый', changedAt: T0 }, nowMs: T0 + 300,
  });
  assert.deepEqual(notice, { queued: false, reason: 'global_cap' });
});

test('capsChecked: после успешного issueToken письмо не перепроверяет мягкий предохранитель', async () => {
  process.env.MAIL_AUTH_HOURLY_CAP = '2';
  await db.tx(async (sql) => {
    const secret = await issueToken(sql, { userId: 'rec-1', email: 'rec1@x.kz', kind: 'password_reset', nowMs: T0 });
    assert.ok(secret);
    // параллельная транзакция успела добавить письмо auth: предохранитель теперь исчерпан
    await enqueueMail(sql, { template: 'password_changed', locale: 'ru', to: 'rec2@x.kz', userId: 'rec-2', params: { name: 'В', changedAt: T0 }, nowMs: T0 });
    await enqueueMail(sql, { template: 'password_changed', locale: 'ru', to: 'rec2@x.kz', userId: 'rec-2', params: { name: 'В', changedAt: T0 }, nowMs: T0 });
    const input = { template: 'password_reset', locale: 'ru', to: 'rec1@x.kz', userId: 'rec-1', params: { name: 'П' }, secret, nowMs: T0 } as const;
    assert.deepEqual(await enqueueMail(sql, input), { queued: false, reason: 'global_cap' }, 'без признака лимит проверяется снова');
    const res = await enqueueMail(sql, { ...input, capsChecked: true });
    assert.ok(res.queued, 'с признаком письмо ставится');
  });
});

test('блокировки consumeToken и issueToken в одном порядке: параллельные выдача и расход без взаимоблокировки', async () => {
  let current = await db.tx(async (sql) => {
    const s = await issueToken(sql, { userId: 'rec-1', email: 'rec1@x.kz', kind: 'password_reset', nowMs: T0 });
    assert.ok(s);
    return s.raw;
  });
  for (let i = 0; i < 40; i++) {
    const [issued, used] = await Promise.all([
      db.tx(async (sql) => {
        const s = await issueToken(sql, { userId: 'rec-1', email: 'rec1@x.kz', kind: 'password_reset', nowMs: T0 + 10 + i });
        return s;
      }),
      db.tx((sql) => consumeToken(sql, current, 'password_reset', T0 + 10 + i)),
    ]);
    assert.ok(issued, 'выдача прошла');
    void used; // расход может проиграть выдаче: важно лишь отсутствие взаимоблокировки
    current = issued.raw;
  }
  const [live] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM auth_tokens WHERE user_id = 'rec-1' AND used_at IS NULL`;
  assert.equal(live?.n, 1, 'жив ровно один токен');
});

test('server actions сброса пароля: ответы, лимиты, cookie, закрытие сессий', () => {
  const env = { ...process.env };
  for (const k of ['DATABASE_URL', 'SESSION_SECRET', 'TEST_DATABASE_URL', 'DEMO_MODE', 'TRUST_X_REAL_IP', 'NODE_TEST_CONTEXT']) delete env[k];
  env.TRUSTED_PROXY_HOPS = '1';
  const res = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks', '--no-warnings', '--import', 'tsx', '--test',
      '--test-name-pattern=^recovery:', path.join(here, 'fixtures/auth-recovery.flow.ts'),
    ],
    { env, encoding: 'utf8', timeout: 180_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 5\b/);
  assert.match(res.stdout, /# fail 0\b/);
});
