// Воркер очереди писем (подставной транспорт): отправка, повторы, окончательный отказ, аренда, очистка.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import type { MailTransport } from '../../src/lib/mail/transport';
import { deliverPending, LEASE_MS, purgeMail, RETRY_DELAYS_MS } from '../../src/lib/mail/worker';

let db: TestDb;
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const TOKEN = 'T'.repeat(43);

type Sent = Parameters<MailTransport['send']>[0];
function fakeTransport(behavior: (m: Sent) => Promise<{ providerId?: string }> | { providerId?: string } = () => ({ providerId: 'pid-1' })) {
  const calls: Sent[] = [];
  const transport: MailTransport = {
    name: 'smtp',
    async send(m) {
      calls.push(m);
      return behavior(m);
    },
  };
  return { transport, calls };
}

const saved = { from: process.env.MAIL_FROM, retention: process.env.MAIL_RETENTION_DAYS };
before(async () => {
  process.env.MAIL_FROM = 'ЦРП <noreply@example.kz>';
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'u1@x.kz', 'Первый', 1)`;
});
beforeEach(async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await db.sql`DELETE FROM audit_log`;
  await db.sql`DELETE FROM auth_tokens`;
});
afterEach(() => {
  if (saved.retention === undefined) delete process.env.MAIL_RETENTION_DAYS;
  else process.env.MAIL_RETENTION_DAYS = saved.retention;
});
after(async () => {
  if (saved.from === undefined) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = saved.from;
  await db.close();
});

type Over = Partial<{
  template: string; status: string; secret: string | null; secretExpiresAt: number | null; attempts: number;
  nextAttemptAt: number | null; leaseUntilAt: number | null; createdAt: number; to: string;
}>;
let seq = 0;
async function letter(over: Over = {}): Promise<string> {
  const id = `m${String(++seq).padStart(4, '0')}`;
  const template = over.template ?? 'assignment_new';
  const secretTemplate = template === 'password_reset' || template === 'email_verify';
  const secret = over.secret === undefined ? (secretTemplate ? TOKEN : null) : over.secret;
  const secretExpiresAt = over.secretExpiresAt === undefined ? (secret ? T0 + HOUR : null) : over.secretExpiresAt;
  const params = secretTemplate ? { name: 'Первый' } : { name: 'Первый', courseSlug: 'c1', courseTitle: { ru: 'Курс' }, dueAt: null };
  await db.sql`
    INSERT INTO mail_outbox (id, category, template, locale, user_id, to_email, params, secret, secret_expires_at, status,
                             attempts, next_attempt_at, lease_until_at, created_at, updated_at)
    VALUES (${id}, ${secretTemplate ? 'auth' : 'notice'}, ${template}, 'ru', 'u1', ${over.to ?? 'ivan@example.kz'}, ${db.json(params)},
            ${secret}, ${secretExpiresAt}, ${over.status ?? 'queued'}, ${over.attempts ?? 0}, ${over.nextAttemptAt ?? null},
            ${over.leaseUntilAt ?? null}, ${over.createdAt ?? T0}, ${over.createdAt ?? T0})`;
  return id;
}

type Row = {
  status: string; attempts: number; secret: string | null; secretExpiresAt: number | null; nextAttemptAt: number | null;
  leaseUntilAt: number | null; lastError: string | null; providerId: string | null; sentAt: number | null;
};
async function row(id: string): Promise<Row> {
  const [r] = await db.sql<Row>`
    SELECT status, attempts, secret, secret_expires_at, next_attempt_at, lease_until_at, last_error, provider_id, sent_at
    FROM mail_outbox WHERE id = ${id}`;
  assert.ok(r, 'письмо есть');
  return r;
}

test('успех: sent, секрет и аренда сняты, в транспорт ушли отправитель, получатель и ссылка', async () => {
  const id = await letter({ template: 'password_reset' });
  const { transport, calls } = fakeTransport();
  const res = await deliverPending({ transport, nowMs: T0 });
  assert.deepEqual(res, { sent: 1, retried: 0, failed: 0, cancelled: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.id, id);
  assert.equal(calls[0]?.to, 'ivan@example.kz');
  assert.equal(calls[0]?.from, 'ЦРП <noreply@example.kz>');
  assert.ok(calls[0]?.text.includes(`#token=${TOKEN}`), 'в отправляемом письме ссылка с токеном есть');
  const r = await row(id);
  assert.equal(r.status, 'sent');
  assert.equal(r.attempts, 1);
  assert.equal(r.secret, null);
  assert.equal(r.secretExpiresAt, null);
  assert.equal(r.leaseUntilAt, null);
  assert.equal(r.providerId, 'pid-1');
  assert.equal(r.sentAt, T0);
  // отправленное повторно не берётся
  assert.deepEqual(await deliverPending({ transport, nowMs: T0 + HOUR }), { sent: 0, retried: 0, failed: 0, cancelled: 0 });
  assert.equal(calls.length, 1);
});

test('held и ещё не наступившая пауза повтора не отправляются', async () => {
  await letter({ status: 'held' });
  await letter({ nextAttemptAt: T0 + MIN });
  const { transport, calls } = fakeTransport();
  assert.deepEqual(await deliverPending({ transport, nowMs: T0 }), { sent: 0, retried: 0, failed: 0, cancelled: 0 });
  assert.equal(calls.length, 0);
  assert.equal((await deliverPending({ transport, nowMs: T0 + MIN })).sent, 1);
});

test('ошибка: письмо в очереди с паузой 1 мин, попытка 1, в last_error нет адреса; пять ошибок — failed и журнал mail.fail', async () => {
  const id = await letter({ template: 'password_reset', secretExpiresAt: T0 + DAY });
  const { transport, calls } = fakeTransport(() => {
    throw new Error('550 mailbox ivan@example.kz unavailable');
  });

  let t = T0;
  const res = await deliverPending({ transport, nowMs: t });
  assert.deepEqual(res, { sent: 0, retried: 1, failed: 0, cancelled: 0 });
  let r = await row(id);
  assert.equal(r.status, 'queued');
  assert.equal(r.attempts, 1);
  assert.equal(r.nextAttemptAt, t + RETRY_DELAYS_MS[0]!);
  assert.ok(r.lastError && !r.lastError.includes('@') && r.lastError.includes('[email]'));
  assert.equal(r.secret, TOKEN, 'пока повторы идут, секрет цел');
  // до наступления паузы письмо не берётся
  assert.equal((await deliverPending({ transport, nowMs: t + 30_000 })).retried, 0);
  assert.equal(calls.length, 1);

  for (let attempt = 2; attempt <= 4; attempt++) {
    t = r.nextAttemptAt as number;
    assert.equal((await deliverPending({ transport, nowMs: t })).retried, 1);
    r = await row(id);
    assert.equal(r.attempts, attempt);
    assert.equal(r.nextAttemptAt, t + RETRY_DELAYS_MS[attempt - 1]!);
  }

  t = r.nextAttemptAt as number;
  const last = await deliverPending({ transport, nowMs: t });
  assert.deepEqual(last, { sent: 0, retried: 0, failed: 1, cancelled: 0 });
  r = await row(id);
  assert.equal(r.status, 'failed');
  assert.equal(r.attempts, 5);
  assert.equal(r.secret, null);
  assert.equal(r.nextAttemptAt, null);
  assert.equal(calls.length, 5);

  const audit = await db.sql<{ actorId: string | null; entity: string; entityId: string; meta: Record<string, unknown> }>`
    SELECT actor_id, entity, entity_id, meta FROM audit_log WHERE action = 'mail.fail'`;
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.actorId, null);
  assert.equal(audit[0]?.entity, 'mail');
  assert.equal(audit[0]?.entityId, id);
  assert.deepEqual(audit[0]?.meta, { mailId: id, template: 'password_reset' });
  // окончательно проваленное больше не берётся
  assert.deepEqual(await deliverPending({ transport, nowMs: t + 10 * DAY }), { sent: 0, retried: 0, failed: 0, cancelled: 0 });
});

test('истёкшая ссылка: cancelled, секрет снят, транспорт не вызван', async () => {
  const id = await letter({ template: 'email_verify', secretExpiresAt: T0 - 1 });
  const { transport, calls } = fakeTransport();
  const res = await deliverPending({ transport, nowMs: T0 });
  assert.deepEqual(res, { sent: 0, retried: 0, failed: 0, cancelled: 1 });
  assert.equal(calls.length, 0);
  const r = await row(id);
  assert.equal(r.status, 'cancelled');
  assert.equal(r.secret, null);
});

test('письмо со ссылкой, у которого секрета уже нет (очистка), не уходит без ссылки', async () => {
  const id = await letter({ template: 'password_reset', secret: null, secretExpiresAt: null });
  const { transport, calls } = fakeTransport();
  assert.equal((await deliverPending({ transport, nowMs: T0 })).cancelled, 1);
  assert.equal(calls.length, 0);
  assert.equal((await row(id)).status, 'cancelled');
});

test('аренда: просроченная sending берётся снова, действующая — нет', async () => {
  const stale = await letter({ status: 'sending', attempts: 1, leaseUntilAt: T0 - 1 });
  const live = await letter({ status: 'sending', attempts: 1, leaseUntilAt: T0 + MIN });
  const { transport, calls } = fakeTransport();
  const res = await deliverPending({ transport, nowMs: T0 });
  assert.equal(res.sent, 1);
  assert.deepEqual(calls.map((c) => c.id), [stale]);
  assert.equal((await row(stale)).attempts, 2);
  assert.equal((await row(live)).status, 'sending');
});

test('захват ставит аренду на 5 минут', async () => {
  const id = await letter();
  let leaseDuringSend: number | null = null;
  const { transport } = fakeTransport(async () => {
    leaseDuringSend = (await row(id)).leaseUntilAt;
    return {};
  });
  await deliverPending({ transport, nowMs: T0 });
  assert.equal(leaseDuringSend, T0 + LEASE_MS);
  assert.equal(LEASE_MS, 5 * MIN);
});

test('поздний ответ после перехвата письма другим воркером состояние не затирает', async () => {
  const id = await letter();
  const { transport } = fakeTransport(async () => {
    // пока мы «отправляем», аренда истекла и письмо забрал другой воркер: попытка выросла
    await db.sql`UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = ${id}`;
    return {};
  });
  const res = await deliverPending({ transport, nowMs: T0 });
  assert.equal(res.sent, 0);
  const r = await row(id);
  assert.equal(r.status, 'sending');
  assert.equal(r.attempts, 2);
});

test('медленный транспорт: хвост пачки, чью аренду перехватил второй воркер, первый воркер не отправляет', async () => {
  const a = await letter({ createdAt: T0 });
  const b = await letter({ createdAt: T0 + 1 });
  let clk = T0;
  const second = fakeTransport();
  let nested = false;
  const first = fakeTransport(async () => {
    if (!nested) {
      nested = true;
      // отправка первого письма «длилась» дольше аренды: крон запускает второй воркер
      clk = T0 + LEASE_MS + 1;
      await deliverPending({ transport: second.transport, nowMs: clk });
    }
    return {};
  });
  const res = await deliverPending({ transport: first.transport, nowMs: T0, clock: () => clk });
  // второе письмо первый воркер не трогал: его отправил только второй воркер
  assert.deepEqual(first.calls.map((m) => m.id), [a]);
  assert.deepEqual(second.calls.map((m) => m.id).sort(), [a, b].sort());
  assert.equal(res.sent, 0);
  assert.equal((await row(b)).status, 'sent');
});

test('срок ссылки и sent_at считаются на момент отправки, а не захвата пачки', async () => {
  const a = await letter();
  const b = await letter({ template: 'password_reset', secretExpiresAt: T0 + MIN, createdAt: T0 + 1 });
  let clk = T0;
  const { transport, calls } = fakeTransport(async () => {
    clk = T0 + 2 * MIN; // пока уходило первое письмо, ссылка второго истекла
    return {};
  });
  const res = await deliverPending({ transport, nowMs: T0, clock: () => clk });
  assert.equal(calls.length, 1);
  assert.equal(res.sent, 1);
  assert.equal(res.cancelled, 1);
  assert.equal((await row(a)).sentAt, T0 + 2 * MIN);
  assert.equal((await row(b)).status, 'cancelled');
});

test('пачка ограничена параметром batch, порядок — по времени создания', async () => {
  const a = await letter({ createdAt: T0 - 3 });
  const b = await letter({ createdAt: T0 - 2 });
  await letter({ createdAt: T0 - 1 });
  const { transport, calls } = fakeTransport();
  assert.equal((await deliverPending({ transport, nowMs: T0, batch: 2 })).sent, 2);
  assert.deepEqual(calls.map((c) => c.id), [a, b]);
  assert.equal((await deliverPending({ transport, nowMs: T0, batch: 2 })).sent, 1);
});

test('без MAIL_FROM письма не уходят и не захватываются', async () => {
  const id = await letter();
  const was = process.env.MAIL_FROM;
  delete process.env.MAIL_FROM;
  try {
    const { transport, calls } = fakeTransport();
    await assert.rejects(deliverPending({ transport, nowMs: T0 }), /MAIL_FROM/);
    assert.equal(calls.length, 0);
    assert.equal((await row(id)).status, 'queued');
  } finally {
    process.env.MAIL_FROM = was;
  }
});

test('purgeMail: старые письма и токены удаляются, истёкшие секреты снимаются, письма в отправке не трогаем', async () => {
  const fresh = await letter({ createdAt: T0 - DAY, status: 'sent' });
  const old = await letter({ createdAt: T0 - 91 * DAY, status: 'sent' });
  const oldSending = await letter({ createdAt: T0 - 91 * DAY, status: 'sending', leaseUntilAt: T0 + MIN });
  const expiredHeld = await letter({ template: 'password_reset', status: 'held', secretExpiresAt: T0 - 1, createdAt: T0 - 2 * HOUR });
  const expiredQueued = await letter({ template: 'email_verify', status: 'queued', secretExpiresAt: T0 - 1, createdAt: T0 - 2 * HOUR });
  const liveHeld = await letter({ template: 'password_reset', status: 'held', secretExpiresAt: T0 + HOUR });
  const hash = (c: string) => c.repeat(64);
  await db.sql`INSERT INTO auth_tokens (id, user_id, kind, token_hash, email, expires_at, created_at) VALUES
    ('tk-old', 'u1', 'password_reset', ${hash('a')}, 'u1@x.kz', ${T0 - 8 * DAY}, ${T0 - 9 * DAY}),
    ('tk-grace', 'u1', 'password_reset', ${hash('b')}, 'u1@x.kz', ${T0 - 6 * DAY}, ${T0 - 7 * DAY}),
    ('tk-live', 'u1', 'email_verify', ${hash('c')}, 'u1@x.kz', ${T0 + DAY}, ${T0 - HOUR})`;

  const res = await purgeMail(T0);
  assert.deepEqual(res, { letters: 1, tokens: 1, secrets: 2 });

  const ids = (await db.sql<{ id: string }>`SELECT id FROM mail_outbox`).map((r) => r.id);
  assert.ok(!ids.includes(old));
  for (const keep of [fresh, oldSending, expiredHeld, expiredQueued, liveHeld]) assert.ok(ids.includes(keep), keep);
  for (const id of [expiredHeld, expiredQueued]) {
    const r = await row(id);
    assert.equal(r.status, 'cancelled', 'письмо без ссылки не должно уйти');
    assert.equal(r.secret, null);
  }
  assert.equal((await row(liveHeld)).secret, TOKEN);
  assert.equal((await row(liveHeld)).status, 'held');
  const tokens = (await db.sql<{ id: string }>`SELECT id FROM auth_tokens ORDER BY id`).map((r) => r.id);
  assert.deepEqual(tokens, ['tk-grace', 'tk-live']);
});

test('purgeMail: срок хранения берётся из MAIL_RETENTION_DAYS', async () => {
  process.env.MAIL_RETENTION_DAYS = '40';
  const older = await letter({ createdAt: T0 - 41 * DAY, status: 'sent' });
  const younger = await letter({ createdAt: T0 - 39 * DAY, status: 'sent' });
  assert.equal((await purgeMail(T0)).letters, 1);
  const ids = (await db.sql<{ id: string }>`SELECT id FROM mail_outbox`).map((r) => r.id);
  assert.deepEqual(ids, [younger]);
  assert.ok(!ids.includes(older));
});

test('purgeMail: срок короче 31 дня поднимается до 31 — письма внутри окна напоминаний не удаляются', async () => {
  process.env.MAIL_RETENTION_DAYS = '10';
  const eleven = await letter({ createdAt: T0 - 11 * DAY, status: 'sent' });
  const old = await letter({ createdAt: T0 - 32 * DAY, status: 'sent' });
  assert.equal((await purgeMail(T0)).letters, 1);
  const ids = (await db.sql<{ id: string }>`SELECT id FROM mail_outbox`).map((r) => r.id);
  assert.deepEqual(ids, [eleven]);
  assert.ok(!ids.includes(old));
});
