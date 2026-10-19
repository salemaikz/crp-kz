// Очередь писем: статусы, регистр адреса, лимиты, идемпотентность, снятие писем с секретами.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { cancelSecrets, enqueueMail } from '../../src/lib/mail/outbox';
import type { EnqueueInput } from '../../src/lib/mail/types';

let db: TestDb;
let savedCap: string | undefined;
const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

before(async () => {
  savedCap = process.env.MAIL_AUTH_HOURLY_CAP;
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES
    ('u1', 'u1@x.kz', 'Первый', 1), ('u2', 'u2@x.kz', 'Второй', 1)`;
});
beforeEach(async () => {
  await db.sql`DELETE FROM mail_outbox`;
});
afterEach(() => {
  if (savedCap === undefined) delete process.env.MAIL_AUTH_HOURLY_CAP;
  else process.env.MAIL_AUTH_HOURLY_CAP = savedCap;
});
after(async () => {
  await db.close();
});

const reset = (to: string, over: Partial<EnqueueInput<'password_reset'>> = {}): EnqueueInput<'password_reset'> => ({
  template: 'password_reset',
  locale: 'ru',
  to,
  userId: 'u1',
  params: { name: 'Первый' },
  secret: { raw: 'A'.repeat(43), expiresAt: T0 + HOUR },
  nowMs: T0,
  ...over,
});

const notice = (to: string, key: string): EnqueueInput<'assignment_new'> => ({
  template: 'assignment_new',
  locale: 'ru',
  to,
  userId: 'u1',
  params: { name: 'Первый', courseSlug: 'c', courseTitle: { ru: 'Курс' }, dueAt: null },
  dedupeKey: key,
  nowMs: T0,
});

test('транспорт outbox: письмо сохраняется со статусом held, адрес в нижнем регистре', async () => {
  const r = await enqueueMail(db.sql, reset('  Mixed.Case@Example.KZ '));
  assert.ok(r.queued);
  assert.equal(r.queued && r.status, 'held');
  const [row] = await db.sql<{ toEmail: string; status: string; category: string; nextAttemptAt: number | null; secret: string | null }>`
    SELECT to_email, status, category, next_attempt_at, secret FROM mail_outbox`;
  assert.equal(row?.toEmail, 'mixed.case@example.kz');
  assert.equal(row?.status, 'held');
  assert.equal(row?.category, 'auth');
  assert.equal(row?.nextAttemptAt, null);
  assert.equal(row?.secret, 'A'.repeat(43));
});

test('лимит получателя не обходится регистром букв: шестое письмо за час — recipient_cap', async () => {
  const variants = ['a@x.kz', 'A@x.kz', 'a@X.KZ', 'A@X.kz', ' a@x.kz', 'a@x.kz '];
  const results = [];
  for (const v of variants.slice(0, 5)) results.push(await enqueueMail(db.sql, reset(v)));
  assert.ok(results.every((r) => r.queued));
  const sixth = await enqueueMail(db.sql, reset(variants[5] as string));
  assert.deepEqual(sixth, { queued: false, reason: 'recipient_cap' });
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox WHERE to_email = 'a@x.kz'`;
  assert.equal(n?.n, 5);
});

test('лимит получателя скользит: через час письмо снова ставится; другому адресу можно сразу', async () => {
  for (let i = 0; i < 5; i++) await enqueueMail(db.sql, reset('b@x.kz'));
  assert.equal((await enqueueMail(db.sql, reset('b@x.kz'))).queued, false);
  assert.equal((await enqueueMail(db.sql, reset('c@x.kz'))).queued, true);
  assert.equal((await enqueueMail(db.sql, reset('b@x.kz', { nowMs: T0 + HOUR + 1 }))).queued, true);
});

test('параллельные письма одному получателю: ровно пять проходят', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => db.tx((sql) => enqueueMail(sql, reset('race@x.kz')))));
  assert.equal(results.filter((r) => r.queued).length, 5);
  assert.equal(results.filter((r) => !r.queued && r.reason === 'recipient_cap').length, 3);
});

test('общий предохранитель: MAIL_AUTH_HOURLY_CAP=3 — четвёртое auth-письмо global_cap', async () => {
  process.env.MAIL_AUTH_HOURLY_CAP = '3';
  const err = console.error;
  const calls: unknown[][] = [];
  console.error = (...a: unknown[]) => void calls.push(a);
  try {
    for (const to of ['p1@x.kz', 'p2@x.kz', 'p3@x.kz']) assert.equal((await enqueueMail(db.sql, reset(to))).queued, true);
    assert.deepEqual(await enqueueMail(db.sql, reset('p4@x.kz')), { queued: false, reason: 'global_cap' });
    // notice-письма предохранитель не считает и не ограничивает
    assert.equal((await enqueueMail(db.sql, notice('p5@x.kz', 'k-global'))).queued, true);
  } finally {
    console.error = err;
  }
  // в лог не попали адреса
  assert.ok(calls.length >= 1);
  assert.ok(!JSON.stringify(calls).includes('@'));
});

test('notice-письма лимит получателя не трогают', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await enqueueMail(db.sql, notice('n@x.kz', `k${i}`))).queued, true);
  // и не занимают лимит auth-писем того же получателя
  for (let i = 0; i < 5; i++) assert.equal((await enqueueMail(db.sql, reset('n@x.kz'))).queued, true);
  assert.equal((await enqueueMail(db.sql, reset('n@x.kz'))).queued, false);
});

test('dedupeKey: повтор — duplicate, без второй строки; без ключа дубли допустимы', async () => {
  const first = await enqueueMail(db.sql, notice('d@x.kz', 'assigned:e1:none'));
  assert.ok(first.queued);
  assert.deepEqual(await enqueueMail(db.sql, notice('d@x.kz', 'assigned:e1:none')), { queued: false, reason: 'duplicate' });
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox WHERE dedupe_key = 'assigned:e1:none'`;
  assert.equal(n?.n, 1);
  const free: EnqueueInput<'assignment_new'> = { ...notice('d@x.kz', 'x'), dedupeKey: undefined };
  assert.ok((await enqueueMail(db.sql, free)).queued);
  assert.ok((await enqueueMail(db.sql, free)).queued);
});

test('секрет: только у password_reset и email_verify, и обязателен для них', async () => {
  await assert.rejects(enqueueMail(db.sql, { ...reset('s@x.kz'), secret: undefined }), /секрета/);
  await assert.rejects(
    enqueueMail(db.sql, { ...notice('s@x.kz', 'ks'), secret: { raw: 'A'.repeat(43), expiresAt: T0 + HOUR } } as EnqueueInput<'assignment_new'>),
    /только у писем со ссылкой/,
  );
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
  assert.equal(n?.n, 0);
});

test('письмо живёт в транзакции вызывающего: откат убирает и письмо', async () => {
  await assert.rejects(
    db.tx(async (sql) => {
      await enqueueMail(sql, reset('tx@x.kz'));
      throw new Error('откат');
    }),
    /откат/,
  );
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
  assert.equal(n?.n, 0);
});

test('cancelSecrets: снимает held и queued письма пользователя нужного шаблона, остальные не трогает', async () => {
  await enqueueMail(db.sql, reset('u1@x.kz', { userId: 'u1' }));
  await enqueueMail(db.sql, reset('u1@x.kz', { userId: 'u1' }));
  await enqueueMail(db.sql, reset('u2@x.kz', { userId: 'u2' }));
  await enqueueMail(db.sql, {
    template: 'email_verify',
    locale: 'ru',
    to: 'u1@x.kz',
    userId: 'u1',
    params: { name: 'Первый' },
    secret: { raw: 'B'.repeat(43), expiresAt: T0 + HOUR },
    nowMs: T0,
  });
  // уже отправленное письмо не меняется
  await db.sql`UPDATE mail_outbox SET status = 'sent', secret = NULL, secret_expires_at = NULL
               WHERE id = (SELECT id FROM mail_outbox WHERE user_id = 'u1' AND template = 'password_reset' ORDER BY id LIMIT 1)`;

  const n = await cancelSecrets(db.sql, { userId: 'u1', template: 'password_reset', nowMs: T0 + 5 });
  assert.equal(n, 1);
  const rows = await db.sql<{ userId: string; template: string; status: string; secret: string | null }>`
    SELECT user_id, template, status, secret FROM mail_outbox ORDER BY user_id, template, status`;
  const of = (u: string, t: string) => rows.filter((r) => r.userId === u && r.template === t);
  assert.deepEqual(of('u1', 'password_reset').map((r) => [r.status, r.secret]).sort(), [['cancelled', null], ['sent', null]]);
  assert.deepEqual(of('u2', 'password_reset').map((r) => [r.status, r.secret !== null]), [['held', true]]);
  assert.deepEqual(of('u1', 'email_verify').map((r) => [r.status, r.secret !== null]), [['held', true]]);
  assert.equal(await cancelSecrets(db.sql, { userId: 'u1', template: 'password_reset' }), 0);
});
