import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { canAccessCourse, DAY_MS, getEnrollment } from '../../src/lib/access';
import { seed, seedUserId } from '../../src/lib/db/seed';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { cancelOrder, markPaid, refundOrder } from '../../src/lib/orders/admin';
import { verifyOrderAccessKey } from '../../src/lib/orders/access-key';
import { createOrder } from '../../src/lib/orders/create';
import { orderNumberPrefix } from '../../src/lib/orders/number';
import { buyState, getCourseForSale, getOrderByNumber, listOrders, orderStats } from '../../src/lib/orders/queries';
import { OrderError, type Order } from '../../src/lib/orders/types';
import type { CheckoutInput } from '../../src/lib/orders/validation';

let db: TestDb;
let salesId: string;
let celinaId: string;
const adminId = seedUserId('admin@crp.demo');
const clientId = seedUserId('client@crp.demo');
const operatorId = seedUserId('operator@crp.demo');

let seq = 0;
function input(o: Partial<CheckoutInput> = {}): CheckoutInput {
  seq += 1;
  return {
    courseSlug: 'sales-doubling',
    buyerType: 'person',
    name: `Покупатель ${seq}`,
    email: `buyer-${seq}@example.kz`,
    phone: '+7 701 100 09 29',
    companyName: null,
    companyBin: null,
    paymentMethod: 'kaspi',
    ...o,
  };
}

async function order(id: string): Promise<Order> {
  const [o] = await db.sql<Order>`SELECT * FROM orders WHERE id = ${id}`;
  assert.ok(o, `order ${id}`);
  return o;
}

async function count(q: Promise<Array<{ n: number }>>): Promise<number> {
  const [r] = await q;
  return Number(r?.n ?? 0);
}

async function guestOrder(o: Partial<CheckoutInput> = {}) {
  return createOrder(input(o), { userId: null });
}

before(async () => {
  db = await createTestDb();
  await seed(db);
  const rows = await db.sql<{ id: string; slug: string }>`SELECT id, slug FROM courses`;
  salesId = rows.find((r) => r.slug === 'sales-doubling')?.id as string;
  celinaId = rows.find((r) => r.slug === 'celina')?.id as string;
  assert.ok(salesId && celinaId);
});
after(async () => {
  await db.close();
});

test('заказ: pending, сумма из предложения, номер CRP-…, согласия, журнал без ПДн', async () => {
  const created = await guestOrder({ email: 'new.buyer@example.kz' });
  assert.match(created.number, /^CRP-\d{6}-\d{4}$/);
  assert.ok(created.number.startsWith(orderNumberPrefix(Date.now())));
  assert.equal(created.amountKzt, 49000);
  assert.equal(created.userId, null);
  assert.equal(verifyOrderAccessKey(created.id, created.accessKey), true);

  const o = await order(created.id);
  assert.equal(o.status, 'pending');
  assert.equal(o.amountKzt, 49000);
  assert.equal(o.courseId, salesId);
  assert.equal(o.userId, null);
  assert.equal(o.buyerEmail, 'new.buyer@example.kz');
  assert.equal(o.paidAt, null);

  const consents = await db.sql<{ kind: string; version: string; userId: string | null }>`
    SELECT kind, version, user_id FROM consents WHERE order_id = ${created.id} ORDER BY kind`;
  assert.deepEqual(
    consents.map((c) => [c.kind, c.version]),
    [
      ['offer', '2026-10-19'],
      ['pd_processing', '2026-10-19'],
    ],
  );

  const audit = await db.sql<{ meta: Record<string, unknown> }>`
    SELECT meta FROM audit_log WHERE action = 'order.create' AND entity_id = ${created.id}`;
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.meta.amountKzt, 49000);
  assert.ok(!JSON.stringify(audit[0]?.meta).includes('new.buyer@example.kz'), 'в журнале нет email');
});

test('сумма берётся из предложения в момент заказа, а не из формы и не из прошлых заказов', async () => {
  const before = await guestOrder();
  await db.sql`UPDATE course_offers SET price_kzt = 55000 WHERE course_id = ${salesId}`;
  try {
    const after = await guestOrder();
    assert.equal((await order(after.id)).amountKzt, 55000);
    assert.equal((await order(before.id)).amountKzt, 49000);
  } finally {
    await db.sql`UPDATE course_offers SET price_kzt = 49000 WHERE course_id = ${salesId}`;
  }
});

test('user_id: вошедший → его аккаунт; гость с email существующего пользователя → этот пользователь', async () => {
  const mine = await createOrder(input({ email: 'other@example.kz' }), { userId: operatorId });
  assert.equal((await order(mine.id)).userId, operatorId);
  const byEmail = await guestOrder({ email: 'client@crp.demo', courseSlug: 'sales-doubling' });
  assert.equal((await order(byEmail.id)).userId, clientId);
});

test('бесплатный, внутренний, неизвестный курс и курс без активного предложения купить нельзя', async () => {
  assert.equal((await getCourseForSale('razbor')).kind, 'not_for_sale');
  assert.equal((await getCourseForSale('operator-onboarding')).kind, 'missing');
  assert.equal((await getCourseForSale('no-such-course')).kind, 'missing');
  assert.equal((await getCourseForSale('sales-doubling')).kind, 'ok');

  for (const slug of ['razbor', 'operator-onboarding', 'no-such-course']) {
    await assert.rejects(guestOrder({ courseSlug: slug }), (e) => e instanceof OrderError && e.code === 'not_for_sale');
  }
  await db.sql`UPDATE course_offers SET active = false WHERE course_id = ${salesId}`;
  try {
    assert.equal((await getCourseForSale('sales-doubling')).kind, 'not_for_sale');
    await assert.rejects(guestOrder(), (e) => e instanceof OrderError && e.code === 'not_for_sale');
  } finally {
    await db.sql`UPDATE course_offers SET active = true WHERE course_id = ${salesId}`;
  }
  await db.sql`UPDATE courses SET status = 'draft' WHERE id = ${salesId}`;
  try {
    assert.equal((await getCourseForSale('sales-doubling')).kind, 'missing');
  } finally {
    await db.sql`UPDATE courses SET status = 'published' WHERE id = ${salesId}`;
  }
});

test('с действующим доступом покупать не нужно: страница отправит к обучению', async () => {
  assert.equal(await buyState(clientId, celinaId), 'has_access'); // «Целина» куплена в сиде
  assert.equal(await buyState(null, celinaId), 'buy');
  assert.equal(await buyState(operatorId, celinaId), 'buy');
  await assert.rejects(
    createOrder(input({ courseSlug: 'celina' }), { userId: clientId }),
    (e) => e instanceof OrderError && e.code === 'has_access',
  );
});

test('markPaid: новый покупатель → аккаунт без пароля, зачисление purchase со сроком из предложения', async () => {
  const created = await guestOrder({ email: 'first.time@example.kz', name: 'Айдана Серикова' });
  const t0 = Date.now();
  const res = await markPaid(created.id, adminId);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.userCreated, true);

  const [user] = await db.sql<{ id: string; name: string; passwordHash: string | null; role: string }>`
    SELECT id, name, password_hash, role FROM users WHERE email = 'first.time@example.kz'`;
  assert.ok(user);
  assert.equal(user.passwordHash, null);
  assert.equal(user.name, 'Айдана Серикова');
  assert.equal(user.role, 'learner');
  assert.equal(res.userId, user.id);

  const o = await order(created.id);
  assert.equal(o.status, 'paid');
  assert.equal(o.userId, user.id);
  assert.equal(o.decidedBy, adminId);
  assert.ok(o.paidAt && o.paidAt >= t0);

  const e = await getEnrollment(user.id, salesId);
  assert.ok(e);
  assert.equal(e.source, 'purchase');
  assert.equal(e.orderId, created.id);
  assert.equal(e.grantedBy, adminId);
  assert.ok(e.expiresAt !== null && Math.abs(e.expiresAt - (t0 + 365 * DAY_MS)) < 60_000);
  assert.equal((await canAccessCourse(user.id, salesId)).ok, true);

  const audits = await count(
    db.sql`SELECT count(*) AS n FROM audit_log WHERE action = 'order.paid' AND entity_id = ${created.id}`,
  );
  assert.equal(audits, 1);
});

test('markPaid идемпотентен: два параллельных вызова — одно зачисление, второй получает already_paid', async () => {
  const created = await guestOrder({ email: 'double.click@example.kz' });
  const results = await Promise.all([markPaid(created.id, adminId), markPaid(created.id, adminId)]);
  const ok = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);
  assert.equal(ok.length, 1);
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0], { ok: false, reason: 'already_paid', status: 'paid' });

  assert.equal(await count(db.sql`SELECT count(*) AS n FROM users WHERE email = 'double.click@example.kz'`), 1);
  const userId = (await order(created.id)).userId as string;
  assert.equal(
    await count(db.sql`SELECT count(*) AS n FROM enrollments WHERE user_id = ${userId} AND course_id = ${salesId}`),
    1,
  );
  assert.equal(
    await count(db.sql`SELECT count(*) AS n FROM audit_log WHERE action = 'order.paid' AND entity_id = ${created.id}`),
    1,
  );
  const again = await markPaid(created.id, adminId);
  assert.deepEqual(again, { ok: false, reason: 'already_paid', status: 'paid' });
});

test('markPaid существующему пользователю: аккаунт не создаётся, доступ — ему', async () => {
  const created = await guestOrder({ email: 'operator@crp.demo' });
  const res = await markPaid(created.id, adminId);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.userCreated, false);
    assert.equal(res.userId, operatorId);
  }
  assert.equal((await canAccessCourse(operatorId, salesId)).ok, true);

  // пользователь зарегистрировался после заказа — оплата найдёт его по email
  const late = await guestOrder({ email: 'late.signup@example.kz' });
  await db.sql`INSERT INTO users (id, email, password_hash, name, created_at)
    VALUES ('late-user', 'late.signup@example.kz', 'x', 'Late', 1)`;
  const lateRes = await markPaid(late.id, adminId);
  assert.equal(lateRes.ok && lateRes.userId, 'late-user');
  assert.equal(lateRes.ok && lateRes.userCreated, false);
});

test('возврат закрывает доступ; возвращённый заказ не оплатить и не вернуть повторно', async () => {
  const created = await guestOrder({ email: 'refund.me@example.kz' });
  const paid = await markPaid(created.id, adminId);
  assert.ok(paid.ok);
  const userId = paid.ok ? (paid.userId as string) : '';

  const res = await refundOrder(created.id, adminId);
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.accessRevoked, true);
  assert.equal((await order(created.id)).status, 'refunded');
  assert.deepEqual(
    { ok: (await canAccessCourse(userId, salesId)).ok, reason: (await canAccessCourse(userId, salesId)).reason },
    { ok: false, reason: 'revoked' },
  );

  assert.deepEqual(await refundOrder(created.id, adminId), { ok: false, reason: 'not_paid', status: 'refunded' });
  assert.deepEqual(await markPaid(created.id, adminId), { ok: false, reason: 'not_pending', status: 'refunded' });
  assert.deepEqual(await cancelOrder(created.id, adminId), { ok: false, reason: 'not_pending', status: 'refunded' });
  assert.equal((await canAccessCourse(userId, salesId)).ok, false, 'доступ не открылся снова');
  assert.equal(
    await count(
      db.sql`SELECT count(*) AS n FROM audit_log WHERE action = 'order.refund' AND entity_id = ${created.id}`,
    ),
    1,
  );
});

test('возврат одного заказа не закрывает доступ, оплаченный другим заказом', async () => {
  const a = await guestOrder({ email: 'renewal@example.kz' });
  assert.ok((await markPaid(a.id, adminId)).ok);
  const b = await guestOrder({ email: 'renewal@example.kz' }); // продление тем же покупателем
  assert.ok((await markPaid(b.id, adminId)).ok);
  const userId = (await order(b.id)).userId as string;
  assert.equal((await order(a.id)).userId, userId);

  const refundA = await refundOrder(a.id, adminId);
  assert.equal(refundA.ok && refundA.accessRevoked, false);
  assert.equal((await canAccessCourse(userId, salesId)).ok, true);

  const refundB = await refundOrder(b.id, adminId);
  assert.equal(refundB.ok && refundB.accessRevoked, true);
  assert.equal((await canAccessCourse(userId, salesId)).ok, false);
});

test('отменённый заказ нельзя оплатить; отмена доступ не выдаёт', async () => {
  const created = await guestOrder({ email: 'cancel.me@example.kz' });
  const res = await cancelOrder(created.id, adminId);
  assert.equal(res.ok, true);
  assert.equal((await order(created.id)).status, 'cancelled');
  assert.deepEqual(await markPaid(created.id, adminId), { ok: false, reason: 'not_pending', status: 'cancelled' });
  assert.deepEqual(await refundOrder(created.id, adminId), { ok: false, reason: 'not_paid', status: 'cancelled' });
  assert.equal(await count(db.sql`SELECT count(*) AS n FROM users WHERE email = 'cancel.me@example.kz'`), 0);
  assert.equal((await order(created.id)).userId, null);
  assert.deepEqual(await cancelOrder('no-such-order', adminId), { ok: false, reason: 'not_found' });
  assert.deepEqual(await markPaid('no-such-order', adminId), { ok: false, reason: 'not_found' });
});

test('номер заказа: при совпадении берутся новые цифры, исчерпание — понятная ошибка', async () => {
  const first = await createOrder(input(), { userId: null, digits: () => 42 });
  assert.ok(first.number.endsWith('-0042'));
  const seqDigits = [42, 42, 43];
  const second = await createOrder(input(), { userId: null, digits: () => seqDigits.shift() as number });
  assert.ok(second.number.endsWith('-0043'));
  await assert.rejects(
    createOrder(input(), { userId: null, digits: () => 42, maxAttempts: 3 }),
    (e) => e instanceof OrderError && e.code === 'number_exhausted',
  );
});

test('выборки для страниц: заказ по номеру с курсом, фильтр и счётчики админки', async () => {
  const created = await guestOrder({
    buyerType: 'company',
    companyName: 'ТОО «Тест»',
    companyBin: '980101400008',
    paymentMethod: 'invoice',
  });
  const view = await getOrderByNumber(created.number);
  assert.ok(view);
  assert.equal(view.courseSlug, 'sales-doubling');
  assert.equal(view.courseTitle.ru, 'Удвоение личных продаж');
  assert.equal(view.accessDays, 365);
  assert.equal(view.companyBin, '980101400008');
  assert.equal((await getOrderByNumber('DEMO-1003'))?.status, 'pending');

  const pending = await listOrders('pending');
  assert.ok(pending.length > 0 && pending.every((o) => o.status === 'pending'));
  assert.ok(pending.some((o) => o.number === created.number));
  const stats = await orderStats();
  const all = await listOrders('all');
  assert.equal(stats.pending.count + stats.paid.count + stats.cancelled.count + stats.refunded.count, all.length);
  assert.equal(stats.pending.count, pending.length);
});
