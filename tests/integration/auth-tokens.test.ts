// Токены ссылок: выдача гасит прежние и снимает их письма, расход одноразовый, срок и смена email.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { consumeToken, hashToken, issueToken, TOKEN_TTL_MS } from '../../src/lib/auth/tokens';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { enqueueMail } from '../../src/lib/mail/outbox';

let db: TestDb;
const T0 = 1_800_000_000_000;

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES
    ('u1', 'u1@x.kz', 'Первый', 1), ('u2', 'u2@x.kz', 'Второй', 1)`;
});
beforeEach(async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await db.sql`DELETE FROM auth_tokens`;
  await db.sql`UPDATE users SET email = 'u1@x.kz' WHERE id = 'u1'`;
});
after(async () => {
  await db.close();
});

/** Выдать токен и поставить его письмо, как это делает действие в одной транзакции. */
async function issueWithMail(userId: string, kind: 'password_reset' | 'email_verify', nowMs = T0) {
  return db.tx(async (sql) => {
    const email = `${userId}@x.kz`;
    const secret = await issueToken(sql, { userId, email, kind, nowMs });
    assert.ok(secret, 'лимит не должен срабатывать');
    const res = await enqueueMail(sql, { template: kind, locale: 'ru', to: email, userId, params: { name: 'Имя' }, secret, nowMs });
    assert.ok(res.queued);
    return { secret, mailId: res.queued ? res.id : '' };
  });
}

test('выдача: в БД только хеш, срок по виду токена', async () => {
  const issued = await db.tx((sql) => issueToken(sql, { userId: 'u1', email: 'u1@x.kz', kind: 'password_reset', nowMs: T0 }));
  assert.ok(issued);
  const { raw, expiresAt } = issued;
  assert.equal(expiresAt, T0 + TOKEN_TTL_MS.password_reset);
  const rows = await db.sql<{ tokenHash: string; expiresAt: number; usedAt: number | null; email: string }>`SELECT * FROM auth_tokens`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.tokenHash, hashToken(raw));
  assert.ok(!JSON.stringify(rows).includes(raw), 'сырой токен не хранится в auth_tokens');
  assert.equal(rows[0]?.usedAt, null);

  const v = await db.tx((sql) => issueToken(sql, { userId: 'u1', email: 'u1@x.kz', kind: 'email_verify', nowMs: T0 }));
  assert.equal(v?.expiresAt, T0 + TOKEN_TTL_MS.email_verify);
});

test('новая выдача гасит прежний токен и отменяет его письмо', async () => {
  const first = await issueWithMail('u1', 'password_reset');
  const second = await issueWithMail('u1', 'password_reset', T0 + 1000);
  assert.equal(await db.tx((sql) => consumeToken(sql, first.secret.raw, 'password_reset', T0 + 2000)), null);
  const [mail] = await db.sql<{ status: string; secret: string | null }>`SELECT status, secret FROM mail_outbox WHERE id = ${first.mailId}`;
  assert.deepEqual(mail, { status: 'cancelled', secret: null });
  const [live] = await db.sql<{ status: string }>`SELECT status FROM mail_outbox WHERE id = ${second.mailId}`;
  assert.equal(live?.status, 'held');
  assert.deepEqual(await db.tx((sql) => consumeToken(sql, second.secret.raw, 'password_reset', T0 + 2000)), { userId: 'u1', email: 'u1@x.kz' });
});

test('выдача не трогает токены другого вида и другого пользователя', async () => {
  const verify = await issueWithMail('u1', 'email_verify');
  const other = await issueWithMail('u2', 'password_reset');
  await issueWithMail('u1', 'password_reset', T0 + 10);
  assert.ok(await db.tx((sql) => consumeToken(sql, verify.secret.raw, 'email_verify', T0 + 20)));
  assert.ok(await db.tx((sql) => consumeToken(sql, other.secret.raw, 'password_reset', T0 + 20)));
});

test('повторное использование и вид: второй расход и чужой вид — null', async () => {
  const { secret } = await issueWithMail('u1', 'password_reset');
  assert.equal(await db.tx((sql) => consumeToken(sql, secret.raw, 'email_verify', T0 + 5)), null, 'токен сброса не подтверждает email');
  assert.ok(await db.tx((sql) => consumeToken(sql, secret.raw, 'password_reset', T0 + 5)));
  assert.equal(await db.tx((sql) => consumeToken(sql, secret.raw, 'password_reset', T0 + 6)), null);
});

test('истечение: ровно в срок и позже — null, до срока — успех', async () => {
  const { secret } = await issueWithMail('u1', 'password_reset');
  const ttl = TOKEN_TTL_MS.password_reset;
  assert.equal(await db.tx((sql) => consumeToken(sql, secret.raw, 'password_reset', T0 + ttl)), null);
  assert.equal(await db.tx((sql) => consumeToken(sql, secret.raw, 'password_reset', T0 + ttl + 60_000)), null);
  const again = await issueWithMail('u1', 'password_reset', T0 + 10);
  assert.ok(await db.tx((sql) => consumeToken(sql, again.secret.raw, 'password_reset', T0 + 10 + ttl - 1)));
});

test('смена email после выдачи: ссылка недействительна', async () => {
  const { secret } = await issueWithMail('u1', 'email_verify');
  await db.sql`UPDATE users SET email = 'changed@x.kz' WHERE id = 'u1'`;
  assert.equal(await db.tx((sql) => consumeToken(sql, secret.raw, 'email_verify', T0 + 5)), null);
});

test('мусор вместо токена: null без обращения к данным', async () => {
  for (const bad of ['', 'abc', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`]) {
    assert.equal(await db.tx((sql) => consumeToken(sql, bad, 'password_reset', T0)), null, bad);
  }
  assert.equal(await db.tx((sql) => consumeToken(sql, 'A'.repeat(43), 'password_reset', T0)), null);
});

test('гонка: один токен расходуется ровно один раз', async () => {
  const { secret } = await issueWithMail('u1', 'password_reset');
  const results = await Promise.all(Array.from({ length: 6 }, () => db.tx((sql) => consumeToken(sql, secret.raw, 'password_reset', T0 + 5))));
  assert.equal(results.filter((r) => r !== null).length, 1);
});

test('адрес в токене берётся из users, расхождение вне регистра — ошибка', async () => {
  await db.sql`UPDATE users SET email = 'Mixed@x.kz' WHERE id = 'u1'`;
  const issued = await db.tx((sql) => issueToken(sql, { userId: 'u1', email: 'mixed@X.kz', kind: 'password_reset', nowMs: T0 }));
  assert.ok(issued);
  assert.deepEqual(await db.tx((sql) => consumeToken(sql, issued.raw, 'password_reset', T0 + 1)), { userId: 'u1', email: 'Mixed@x.kz' });
  await assert.rejects(db.tx((sql) => issueToken(sql, { userId: 'u1', email: 'other@x.kz', kind: 'password_reset', nowMs: T0 })));
});

test('гонка выдачи: после N параллельных выдач жив ровно один токен', async () => {
  await issueWithMail('u1', 'password_reset');
  await Promise.all(Array.from({ length: 4 }, (_, i) => db.tx(async (sql) => {
    const secret = await issueToken(sql, { userId: 'u1', email: 'u1@x.kz', kind: 'password_reset', nowMs: T0 + 10 + i });
    if (secret) await enqueueMail(sql, { template: 'password_reset', locale: 'ru', to: 'u1@x.kz', userId: 'u1', params: { name: 'Имя' }, secret, nowMs: T0 + 10 + i });
  })));
  const [live] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM auth_tokens WHERE user_id = 'u1' AND used_at IS NULL`;
  assert.equal(live?.n, 1);
});

test('лимит писем: отказ не гасит прежнюю ссылку', async () => {
  const issued: Awaited<ReturnType<typeof issueWithMail>>[] = [];
  for (let i = 0; i < 5; i++) issued.push(await issueWithMail('u1', 'password_reset', T0 + i));
  const sixth = await db.tx((sql) => issueToken(sql, { userId: 'u1', email: 'u1@x.kz', kind: 'password_reset', nowMs: T0 + 10 }));
  assert.equal(sixth, null);
  const [orphans] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM auth_tokens WHERE user_id = 'u1'`;
  assert.equal(orphans?.n, 5, 'новый токен не создан');
  assert.ok(await db.tx((sql) => consumeToken(sql, issued[4]!.secret.raw, 'password_reset', T0 + 11)), 'пятая ссылка рабочая');
});
