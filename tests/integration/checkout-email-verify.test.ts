// Заказ только с подтверждённого email (D-032, предложено, ждёт владельца): сценарий #25 целиком
// и поведение при FEATURE_EMAIL_VERIFY=0. Заказ создаёт вошедший владелец аккаунта; email аккаунта,
// занятый заранее чужим человеком, заказ не открывает.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { canAccessCourse } from '../../src/lib/access';
import { hashPassword, verifyPassword } from '../../src/lib/auth/password';
import { requestPasswordReset, resetPassword, sendVerification, verifyEmail } from '../../src/lib/auth/recovery';
import { createSessionToken, resolveSessionToken } from '../../src/lib/auth/session';
import { newId } from '../../src/lib/db';
import { seed, seedUserId } from '../../src/lib/db/seed';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { CHECKOUT_CONSENTS, prepareConsents, type PreparedConsent } from '../../src/lib/legal';
import { markPaid } from '../../src/lib/orders/admin';
import { createOrder } from '../../src/lib/orders/create';
import { OrderError } from '../../src/lib/orders/types';
import type { CheckoutInput } from '../../src/lib/orders/validation';

let db: TestDb;
let prepared: PreparedConsent[];
let salesId: string;
const adminId = seedUserId('admin@crp.demo');

const input: CheckoutInput = {
  courseSlug: 'sales-doubling',
  buyerType: 'person',
  name: 'Покупатель',
  email: 'ignored@example.kz',
  phone: '+7 701 100 09 29',
  companyName: null,
  companyBin: null,
  paymentMethod: 'kaspi',
};

before(async () => {
  db = await createTestDb();
  await seed(db);
  const [row] = await db.sql<{ id: string }>`SELECT id FROM courses WHERE slug = 'sales-doubling'`;
  salesId = row?.id as string;
  assert.ok(salesId);
  prepared = await prepareConsents(CHECKOUT_CONSENTS, 'ru');
});
afterEach(() => {
  delete process.env.FEATURE_EMAIL_VERIFY;
});
after(async () => {
  await db.close();
});

/** Обычный аккаунт без подтверждения (регистрация на @crp.demo — не сид, id случайный). */
async function register(email: string, password: string): Promise<string> {
  const id = newId();
  await db.sql`INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
               VALUES (${id}, ${email}, ${await hashPassword(password)}, 'Пользователь', 'learner', 'ru', 1)`;
  return id;
}

async function counts() {
  const [o] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM orders`;
  const [c] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM consents`;
  const [t] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM legal_texts`;
  const [a] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM audit_log WHERE action = 'order.create'`;
  return { orders: Number(o?.n), consents: Number(c?.n), texts: Number(t?.n), audit: Number(a?.n) };
}

const unverified = (e: unknown) => e instanceof OrderError && e.code === 'email_unverified';

test('сценарий #25: захваченный заранее email не даёт оформить заказ; владелец почты забирает аккаунт через сброс пароля и покупает', async () => {
  // 1. злоумышленник регистрирует чужой адрес; аккаунт не подтверждён, сессия открыта
  const attackerId = await register('victim@crp.demo', 'attacker-password-1');
  const { token: attackerSession } = await createSessionToken(attackerId);
  assert.ok(await resolveSessionToken(attackerSession));

  // 2. заказ закрыт, и ничего не записано: ни заказа, ни согласий, ни копий текстов, ни журнала
  const before = await counts();
  await assert.rejects(createOrder(input, { userId: attackerId, consents: prepared }), unverified);
  assert.deepEqual(await counts(), before);

  // 3. владелец почты просит сброс (обычный аккаунт на @crp.demo — не сид, письмо ставится)
  await requestPasswordReset({ email: 'victim@crp.demo', locale: 'ru' });
  const [mail] = await db.sql<{ secret: string }>`
    SELECT secret FROM mail_outbox WHERE template = 'password_reset' AND to_email = 'victim@crp.demo' AND secret IS NOT NULL`;
  assert.ok(mail, 'письмо сброса поставлено в очередь');
  const reset = await resetPassword({ token: mail.secret, passwordHash: await hashPassword('owner-password-1') });
  assert.deepEqual(reset, { ok: true, userId: attackerId });

  // 4. сессия злоумышленника закрыта, его пароль не проходит
  assert.equal(await resolveSessionToken(attackerSession), null);
  const [u] = await db.sql<{ passwordHash: string; emailVerifiedAt: number | null }>`
    SELECT password_hash, email_verified_at FROM users WHERE id = ${attackerId}`;
  assert.equal(await verifyPassword('attacker-password-1', u?.passwordHash), false);
  assert.equal(await verifyPassword('owner-password-1', u?.passwordHash), true);

  // 5. email подтверждён сбросом: заказ оформляется на этот аккаунт, оплата зачисляется ему
  assert.notEqual(u?.emailVerifiedAt, null);
  const created = await createOrder(input, { userId: attackerId, consents: prepared });
  assert.equal(created.userId, attackerId);
  const [order] = await db.sql<{ userId: string; buyerEmail: string }>`SELECT user_id, buyer_email FROM orders WHERE id = ${created.id}`;
  assert.deepEqual(order, { userId: attackerId, buyerEmail: 'victim@crp.demo' });
  assert.equal((await canAccessCourse(attackerId, salesId)).ok, false);
  assert.ok((await markPaid(created.id, adminId)).ok);
  assert.equal((await canAccessCourse(attackerId, salesId)).ok, true);
});

test('подтверждение по ссылке из письма открывает заказ', async () => {
  const userId = await register('verify.me@example.kz', 'password-123');
  await assert.rejects(createOrder(input, { userId, consents: prepared }), unverified);
  await db.tx((sql) =>
    sendVerification(sql, { userId, email: 'verify.me@example.kz', name: 'Пользователь', locale: 'ru', next: '/ru/courses/sales-doubling/buy' }),
  );
  const [mail] = await db.sql<{ secret: string }>`
    SELECT secret FROM mail_outbox WHERE template = 'email_verify' AND user_id = ${userId} AND secret IS NOT NULL`;
  assert.ok(mail);
  assert.deepEqual(await verifyEmail({ token: mail.secret }), { ok: true, userId });
  const created = await createOrder(input, { userId, consents: prepared });
  assert.equal(created.existing, false);
});

test('неподтверждённому закрыт и повтор: открытый заказ не возвращается, согласия не пишутся', async () => {
  const userId = await register('open.order@example.kz', 'password-123');
  // заказ мог появиться до включения проверки
  process.env.FEATURE_EMAIL_VERIFY = '0';
  const first = await createOrder(input, { userId, consents: prepared });
  delete process.env.FEATURE_EMAIL_VERIFY;
  const before = await counts();
  await assert.rejects(createOrder(input, { userId, consents: prepared }), unverified);
  assert.deepEqual(await counts(), before);
  assert.ok(first.id);
});

test('FEATURE_EMAIL_VERIFY=0: неподтверждённый оформляет заказ как раньше', async () => {
  process.env.FEATURE_EMAIL_VERIFY = '0';
  const userId = await register('plain@example.kz', 'password-123');
  const created = await createOrder(input, { userId, consents: prepared });
  assert.equal(created.existing, false);
  assert.equal((await counts()).orders > 0, true);
});

test('requireVerifiedEmail явно: true требует подтверждения даже при выключенном флаге, false — не требует', async () => {
  const userId = await register('explicit@example.kz', 'password-123');
  process.env.FEATURE_EMAIL_VERIFY = '0';
  await assert.rejects(createOrder(input, { userId, consents: prepared, requireVerifiedEmail: true }), unverified);
  delete process.env.FEATURE_EMAIL_VERIFY;
  const created = await createOrder(input, { userId, consents: prepared, requireVerifiedEmail: false });
  assert.equal(created.existing, false);
});
