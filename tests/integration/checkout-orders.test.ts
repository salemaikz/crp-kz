import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { canAccessCourse, DAY_MS, getEnrollment, revokeEnrollment } from '../../src/lib/access';
import { newId } from '../../src/lib/db';
import { seed, seedUserId } from '../../src/lib/db/seed';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { cancelOrder, markPaid, refundOrder } from '../../src/lib/orders/admin';
import { verifyOrderAccessKey } from '../../src/lib/orders/access-key';
import { createOrder, orderDiffersFrom } from '../../src/lib/orders/create';
import { CHECKOUT_CONSENTS, prepareConsents, type PreparedConsent } from '../../src/lib/legal';
import { cancelOwnOrder } from '../../src/lib/orders/owner';
import { orderNumberPrefix } from '../../src/lib/orders/number';
import { buyState, getCourseForSale, getOrderByNumber, listOrders, orderStats } from '../../src/lib/orders/queries';
import { OrderError, type Order } from '../../src/lib/orders/types';
import type { CheckoutInput } from '../../src/lib/orders/validation';

// Покупка, Фаза 0 (D-007) и разбор ревью (D-020): заказ только вошедшему, привязка только к сессии,
// оплата не создаёт пользователей, срок доступа — снимок в заказе, возвраты с учётом других заказов.

let db: TestDb;
let salesId: string;
let celinaId: string;
/** Подготовленные согласия (в тестах LEGAL активен: демо). */
let prepared: PreparedConsent[];
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
    email: `form-${seq}@example.kz`,
    phone: '+7 701 100 09 29',
    companyName: null,
    companyBin: null,
    paymentMethod: 'kaspi',
    ...o,
  };
}

/** Новый пользователь (как после регистрации). */
async function newUser(email = `user-${newId()}@example.kz`): Promise<string> {
  const id = newId();
  // email подтверждён: без этого при EMAIL_VERIFY заказ закрыт (D-032); неподтверждённых делает newUnverified
  await db.sql`INSERT INTO users (id, email, password_hash, name, role, locale, email_verified_at, created_at)
               VALUES (${id}, ${email}, 'x', 'Пользователь', 'learner', 'ru', 1, 1)`;
  return id;
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

/** Дубль заказа, как если бы он остался с тех пор, когда дубли ещё создавались (до D-020). */
async function legacyDuplicate(of: string): Promise<{ id: string; number: string }> {
  const id = newId();
  const number = `CRP-DUP-${String(++seq).padStart(4, '0')}`;
  await db.sql`
    INSERT INTO orders (id, number, user_id, course_id, amount_kzt, access_days, status, buyer_type, buyer_name,
                        buyer_email, buyer_phone, payment_method, created_at, updated_at)
    SELECT ${id}, ${number}, user_id, course_id, amount_kzt, access_days, 'pending', buyer_type, buyer_name,
           buyer_email, buyer_phone, payment_method, created_at + 1, updated_at + 1
    FROM orders WHERE id = ${of}`;
  return { id, number };
}

before(async () => {
  db = await createTestDb();
  await seed(db);
  const rows = await db.sql<{ id: string; slug: string }>`SELECT id, slug FROM courses`;
  salesId = rows.find((r) => r.slug === 'sales-doubling')?.id as string;
  celinaId = rows.find((r) => r.slug === 'celina')?.id as string;
  assert.ok(salesId && celinaId);
  prepared = await prepareConsents(CHECKOUT_CONSENTS, 'ru');
});
after(async () => {
  await db.close();
});

test('заказ: pending, сумма и срок из предложения, email аккаунта, номер CRP-…, согласия, журнал без ПДн', async () => {
  const userId = await newUser('new.buyer@example.kz');
  const created = await createOrder(input({ email: 'typed.in.form@example.kz' }), { consents: prepared, userId });
  assert.match(created.number, /^CRP-\d{6}-\d{4}$/);
  assert.ok(created.number.startsWith(orderNumberPrefix(Date.now())));
  assert.equal(created.amountKzt, 49000);
  assert.equal(created.userId, userId);
  assert.equal(created.accessDays, 365);
  assert.equal(created.existing, false);
  assert.equal(verifyOrderAccessKey(created.id, created.accessKey), true);

  const o = await order(created.id);
  assert.equal(o.status, 'pending');
  assert.equal(o.amountKzt, 49000);
  assert.equal(o.accessDays, 365);
  assert.equal(o.courseId, salesId);
  assert.equal(o.userId, userId);
  assert.equal(o.buyerEmail, 'new.buyer@example.kz', 'email заказа — email аккаунта, а не из формы');
  assert.equal(o.paidAt, null);

  // LEGAL активен: версия действующей редакции, язык показанного текста, контекст и хэш точного текста
  const consents = await db.sql<{
    kind: string;
    version: string;
    userId: string | null;
    locale: string | null;
    context: string | null;
    textSha256: string | null;
  }>`SELECT kind, version, user_id, locale, context, text_sha256 FROM consents WHERE order_id = ${created.id} ORDER BY kind`;
  assert.deepEqual(
    consents.map((c) => [c.kind, c.userId, c.locale, c.context]),
    [
      ['offer', userId, 'ru', 'checkout'],
      ['pd_processing', userId, 'ru', 'checkout'],
    ],
  );
  for (const c of consents) {
    assert.notEqual(c.version, '2026-10-19', 'не легаси-версия');
    assert.match(c.textSha256 ?? '', /^[0-9a-f]{64}$/);
    const [text] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM legal_texts WHERE sha256 = ${c.textSha256}`;
    assert.equal(text?.n, 1, 'копия текста сохранена по хэшу');
  }

  const audit = await db.sql<{ meta: Record<string, unknown>; actorId: string }>`
    SELECT meta, actor_id FROM audit_log WHERE action = 'order.create' AND entity_id = ${created.id}`;
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.actorId, userId);
  assert.equal(audit[0]?.meta.amountKzt, 49000);
  assert.ok(!JSON.stringify(audit[0]?.meta).includes('new.buyer@example.kz'), 'в журнале нет email');
});

test('гость не может оформить заказ: без пользователя из сессии — login_required, заказ не создаётся', async () => {
  const before = await count(db.sql`SELECT count(*) AS n FROM orders`);
  for (const userId of [null, undefined, '', 'no-such-user']) {
    await assert.rejects(
      createOrder(input(), { consents: prepared, userId: userId as unknown as string }),
      (e) => e instanceof OrderError && e.code === 'login_required',
      String(userId),
    );
  }
  assert.equal(await count(db.sql`SELECT count(*) AS n FROM orders`), before);
});

test('захват покупки невозможен: заказ не ищет пользователя по email (чужой email зарегистрирован заранее)', async () => {
  // злоумышленник заранее зарегистрировал аккаунт на email жертвы
  const attackerId = await newUser('victim@example.kz');
  // жертва вошла в свой аккаунт и в форме указала тот же email
  const victimId = await newUser('victim.real@example.kz');
  const created = await createOrder(input({ email: 'victim@example.kz' }), { consents: prepared, userId: victimId });
  const o = await order(created.id);
  assert.equal(o.userId, victimId);
  assert.equal(o.buyerEmail, 'victim.real@example.kz');

  const res = await markPaid(created.id, adminId);
  assert.ok(res.ok);
  assert.equal(res.ok && res.userId, victimId);
  assert.equal((await canAccessCourse(victimId, salesId)).ok, true);
  assert.equal((await canAccessCourse(attackerId, salesId)).ok, false, 'аккаунт с тем же email ничего не получил');
});

test('повторный заказ при открытом неоплаченном не создаётся: возвращается открытый', async () => {
  const userId = await newUser();
  const first = await createOrder(input({ paymentMethod: 'kaspi' }), { consents: prepared, userId });
  const again = await createOrder(input({ paymentMethod: 'invoice' }), { consents: prepared, userId });
  assert.equal(again.id, first.id);
  assert.equal(again.number, first.number);
  assert.equal(again.existing, true);
  assert.equal(verifyOrderAccessKey(again.id, again.accessKey), true);
  assert.equal(
    await count(db.sql`SELECT count(*) AS n FROM orders WHERE user_id = ${userId} AND course_id = ${salesId}`),
    1,
  );
  // параллельные заказы тоже не плодят дублей
  const userB = await newUser();
  const both = await Promise.all([createOrder(input(), { consents: prepared, userId: userB }), createOrder(input(), { consents: prepared, userId: userB })]);
  assert.equal(both[0].id, both[1].id);
  assert.equal(await count(db.sql`SELECT count(*) AS n FROM orders WHERE user_id = ${userB}`), 1);

  // после отмены открытого — новый заказ
  assert.ok((await cancelOrder(first.id, adminId)).ok);
  const fresh = await createOrder(input(), { consents: prepared, userId });
  assert.notEqual(fresh.id, first.id);
  assert.equal(fresh.existing, false);
});

test('открытый заказ с другими данными: differs; владелец отменяет свой заказ и оформляет новый', async () => {
  const userId = await newUser();
  const first = await createOrder(input({ paymentMethod: 'kaspi' }), { consents: prepared, userId });
  assert.equal(first.differs, false);
  // те же тип покупателя и способ оплаты — открытый заказ без пометки
  const same = await createOrder(input({ paymentMethod: 'kaspi', name: 'Другое имя' }), { consents: prepared, userId });
  assert.deepEqual([same.id, same.existing, same.differs], [first.id, true, false]);
  // другой способ оплаты или тип покупателя — тот же заказ, но с пометкой differs
  const otherMethod = await createOrder(input({ paymentMethod: 'invoice' }), { consents: prepared, userId });
  assert.deepEqual([otherMethod.id, otherMethod.existing, otherMethod.differs], [first.id, true, true]);
  const company = await createOrder(
    input({ buyerType: 'company', companyName: 'ТОО «Тест»', companyBin: '123456789012', paymentMethod: 'kaspi' }),
    { consents: prepared, userId },
  );
  assert.deepEqual([company.id, company.differs], [first.id, true]);

  // чужой пользователь и администратор этим путём не отменяют: not_found, заказ не тронут
  const stranger = await newUser();
  assert.deepEqual(await cancelOwnOrder(first.id, stranger), { ok: false, reason: 'not_found' });
  assert.deepEqual(await cancelOwnOrder(first.id, adminId), { ok: false, reason: 'not_found' });
  assert.deepEqual(await cancelOwnOrder(first.id, ''), { ok: false, reason: 'not_found' });
  assert.equal((await order(first.id)).status, 'pending');

  // владелец отменяет: pending → cancelled, журнал order.cancel_by_owner от его имени
  const res = await cancelOwnOrder(first.id, userId);
  assert.ok(res.ok);
  const o = await order(first.id);
  assert.equal(o.status, 'cancelled');
  assert.equal(o.decidedBy, userId);
  const audit = await db.sql<{ actorId: string; meta: Record<string, unknown> }>`
    SELECT actor_id, meta FROM audit_log WHERE action = 'order.cancel_by_owner' AND entity_id = ${first.id}`;
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.actorId, userId);
  assert.equal(audit[0]?.meta.number, first.number);
  // повтор — отказ, второй записи в журнале нет; отменённый заказ не оплатить
  assert.deepEqual(await cancelOwnOrder(first.id, userId), { ok: false, reason: 'not_pending', status: 'cancelled' });
  assert.equal((await markPaid(first.id, adminId)).ok, false);

  // теперь можно оформить новый — с новыми данными
  const fresh = await createOrder(input({ paymentMethod: 'invoice' }), { consents: prepared, userId });
  assert.notEqual(fresh.id, first.id);
  assert.deepEqual([fresh.existing, fresh.differs], [false, false]);
  assert.equal((await order(fresh.id)).paymentMethod, 'invoice');
});

test('владелец не отменяет оплаченный заказ: already_paid, доступ остаётся', async () => {
  const userId = await newUser();
  const created = await createOrder(input(), { consents: prepared, userId });
  assert.ok((await markPaid(created.id, adminId)).ok);
  assert.deepEqual(await cancelOwnOrder(created.id, userId), { ok: false, reason: 'already_paid', status: 'paid' });
  assert.equal((await order(created.id)).status, 'paid');
  assert.equal((await canAccessCourse(userId, salesId)).ok, true);
});

test('orderDiffersFrom: тип покупателя, способ оплаты, БИН компании; имя и телефон не в счёт', () => {
  const open = { buyerType: 'company', paymentMethod: 'invoice', companyBin: '123456789012' };
  const base = { buyerType: 'company', paymentMethod: 'invoice', companyBin: '123456789012' } as const;
  assert.equal(orderDiffersFrom(open, base), false);
  assert.equal(orderDiffersFrom(open, { ...base, paymentMethod: 'kaspi' }), true);
  assert.equal(orderDiffersFrom(open, { ...base, companyBin: '999999999999' }), true);
  assert.equal(orderDiffersFrom(open, { buyerType: 'person', paymentMethod: 'invoice', companyBin: null }), true);
  assert.equal(
    orderDiffersFrom({ buyerType: 'person', paymentMethod: 'kaspi', companyBin: null }, { buyerType: 'person', paymentMethod: 'kaspi', companyBin: null }),
    false,
  );
});

test('сумма берётся из предложения в момент заказа, а не из формы и не из прошлых заказов', async () => {
  const before = await createOrder(input(), { consents: prepared, userId: await newUser() });
  await db.sql`UPDATE course_offers SET price_kzt = 55000 WHERE course_id = ${salesId}`;
  try {
    const after = await createOrder(input(), { consents: prepared, userId: await newUser() });
    assert.equal((await order(after.id)).amountKzt, 55000);
    assert.equal((await order(before.id)).amountKzt, 49000);
  } finally {
    await db.sql`UPDATE course_offers SET price_kzt = 49000 WHERE course_id = ${salesId}`;
  }
});

test('бесплатный, внутренний, неизвестный курс и курс без активного предложения купить нельзя', async () => {
  const userId = await newUser();
  assert.equal((await getCourseForSale('razbor')).kind, 'not_for_sale');
  assert.equal((await getCourseForSale('operator-onboarding')).kind, 'missing');
  assert.equal((await getCourseForSale('no-such-course')).kind, 'missing');
  assert.equal((await getCourseForSale('sales-doubling')).kind, 'ok');

  for (const slug of ['razbor', 'operator-onboarding', 'no-such-course']) {
    await assert.rejects(
      createOrder(input({ courseSlug: slug }), { consents: prepared, userId }),
      (e) => e instanceof OrderError && e.code === 'not_for_sale',
    );
  }
  await db.sql`UPDATE course_offers SET active = false WHERE course_id = ${salesId}`;
  try {
    assert.equal((await getCourseForSale('sales-doubling')).kind, 'not_for_sale');
    await assert.rejects(createOrder(input(), { consents: prepared, userId }), (e) => e instanceof OrderError && e.code === 'not_for_sale');
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
    createOrder(input({ courseSlug: 'celina' }), { consents: prepared, userId: clientId }),
    (e) => e instanceof OrderError && e.code === 'has_access',
  );
});

test('markPaid: зачисление purchase владельцу заказа со сроком из заказа; пользователи не создаются', async () => {
  const userId = await newUser('first.time@example.kz');
  const created = await createOrder(input({ name: 'Айдана Серикова' }), { consents: prepared, userId });
  const usersBefore = await count(db.sql`SELECT count(*) AS n FROM users`);
  const t0 = Date.now();
  const res = await markPaid(created.id, adminId);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.userId, userId);
  assert.equal(await count(db.sql`SELECT count(*) AS n FROM users`), usersBefore, 'оплата не создаёт пользователей');
  assert.equal(await count(db.sql`SELECT count(*) AS n FROM audit_log WHERE action = 'user.create_from_order'`), 0);

  const o = await order(created.id);
  assert.equal(o.status, 'paid');
  assert.equal(o.userId, userId);
  assert.equal(o.decidedBy, adminId);
  assert.ok(o.paidAt && o.paidAt >= t0);

  const e = await getEnrollment(userId, salesId);
  assert.ok(e);
  assert.equal(e.source, 'purchase');
  assert.equal(e.orderId, created.id);
  assert.equal(e.grantedBy, adminId);
  assert.ok(e.expiresAt !== null && Math.abs(e.expiresAt - (t0 + 365 * DAY_MS)) < 60_000);
  assert.equal((await canAccessCourse(userId, salesId)).ok, true);

  const audits = await count(
    db.sql`SELECT count(*) AS n FROM audit_log WHERE action = 'order.paid' AND entity_id = ${created.id}`,
  );
  assert.equal(audits, 1);
});

test('markPaid никогда не создаёт пользователя: заказ без аккаунта (аккаунт удалён) — отказ no_user', async () => {
  const userId = await newUser('gone@example.kz');
  const created = await createOrder(input(), { consents: prepared, userId });
  await db.sql`DELETE FROM users WHERE id = ${userId}`; // orders.user_id → NULL (ON DELETE SET NULL)
  assert.equal((await order(created.id)).userId, null);

  const res = await markPaid(created.id, adminId);
  assert.deepEqual(res, { ok: false, reason: 'no_user', status: 'pending' });
  assert.equal((await order(created.id)).status, 'pending');
  assert.equal(await count(db.sql`SELECT count(*) AS n FROM users WHERE email = 'gone@example.kz'`), 0);
  // и демо-заказы сида привязаны к аккаунтам: их можно подтвердить
  const [demo] = await db.sql<{ userId: string | null }>`SELECT user_id FROM orders WHERE number = 'DEMO-1002'`;
  assert.ok(demo?.userId);
});

test('markPaid идемпотентен: два параллельных вызова — одно зачисление, второй получает already_paid', async () => {
  const userId = await newUser();
  const created = await createOrder(input(), { consents: prepared, userId });
  const results = await Promise.all([markPaid(created.id, adminId), markPaid(created.id, adminId)]);
  const ok = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);
  assert.equal(ok.length, 1);
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0], { ok: false, reason: 'already_paid', status: 'paid' });

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

test('срок доступа — снимок в заказе: смена предложения после заказа срок не меняет', async () => {
  const userId = await newUser();
  const created = await createOrder(input(), { consents: prepared, userId });
  assert.equal(created.accessDays, 365);
  await db.sql`UPDATE course_offers SET access_days = 30 WHERE course_id = ${salesId}`;
  try {
    // страницы заказа и счёта показывают срок из заказа
    assert.equal((await getOrderByNumber(created.number))?.accessDays, 365);
    const t0 = Date.now();
    assert.ok((await markPaid(created.id, adminId)).ok);
    const e = await getEnrollment(userId, salesId);
    assert.ok(e?.expiresAt && Math.abs(e.expiresAt - (t0 + 365 * DAY_MS)) < 60_000, 'срок из заказа, не 30 дней');

    // новый заказ берёт новый срок
    const later = await createOrder(input(), { consents: prepared, userId: await newUser() });
    assert.equal(later.accessDays, 30);
    assert.equal((await order(later.id)).accessDays, 30);
    // бессрочное предложение → бессрочный заказ и доступ
    await db.sql`UPDATE course_offers SET access_days = NULL WHERE course_id = ${salesId}`;
    const forever = await createOrder(input(), { consents: prepared, userId: await newUser() });
    assert.equal((await order(forever.id)).accessDays, null);
    const paid = await markPaid(forever.id, adminId);
    assert.ok(paid.ok);
    assert.equal((await getEnrollment(paid.ok ? (paid.userId as string) : '', salesId))?.expiresAt, null);
  } finally {
    await db.sql`UPDATE course_offers SET access_days = 365 WHERE course_id = ${salesId}`;
  }
});

test('возврат закрывает доступ; возвращённый заказ не оплатить и не вернуть повторно', async () => {
  const userId = await newUser();
  const created = await createOrder(input(), { consents: prepared, userId });
  assert.ok((await markPaid(created.id, adminId)).ok);

  const res = await refundOrder(created.id, adminId);
  assert.equal(res.ok, true);
  assert.equal(res.ok && res.accessRevoked, true);
  assert.equal((await order(created.id)).status, 'refunded');
  const acc = await canAccessCourse(userId, salesId);
  assert.deepEqual({ ok: acc.ok, reason: acc.reason }, { ok: false, reason: 'revoked' });

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

test('двойная оплата: возврат одного заказа оставляет доступ на другом оплаченном', async () => {
  const userId = await newUser();
  const a = await createOrder(input(), { consents: prepared, userId });
  const b = await legacyDuplicate(a.id);
  assert.ok((await markPaid(a.id, adminId)).ok);
  assert.ok((await markPaid(b.id, adminId)).ok);
  assert.equal((await getEnrollment(userId, salesId))?.orderId, b.id); // последняя оплата — источник

  // возврат B: доступ держался на B → переходит на A (его собственный срок), не закрывается
  const refundB = await refundOrder(b.id, adminId);
  assert.ok(refundB.ok);
  assert.equal(refundB.ok && refundB.accessRevoked, false);
  assert.equal(refundB.ok && refundB.accessMovedTo, a.number);
  const e = await getEnrollment(userId, salesId);
  assert.equal(e?.orderId, a.id);
  assert.equal(e?.source, 'purchase');
  assert.equal(e?.revokedAt, null);
  const paidA = (await order(a.id)).paidAt as number;
  assert.equal(e?.expiresAt, paidA + 365 * DAY_MS, 'срок — от оплаты A, без продления');
  assert.equal((await canAccessCourse(userId, salesId)).ok, true);

  // возврат A: других оплаченных заказов нет — доступ закрыт
  const refundA = await refundOrder(a.id, adminId);
  assert.equal(refundA.ok && refundA.accessRevoked, true);
  assert.equal((await canAccessCourse(userId, salesId)).ok, false);
});

test('возврат A, когда доступ уже держится на B: доступ не трогаем', async () => {
  const userId = await newUser();
  const a = await createOrder(input(), { consents: prepared, userId });
  const b = await legacyDuplicate(a.id);
  assert.ok((await markPaid(a.id, adminId)).ok);
  assert.ok((await markPaid(b.id, adminId)).ok);
  const refundA = await refundOrder(a.id, adminId);
  assert.equal(refundA.ok && refundA.accessRevoked, false);
  assert.equal(refundA.ok && refundA.accessMovedTo, undefined);
  assert.equal((await getEnrollment(userId, salesId))?.orderId, b.id);
  assert.equal((await canAccessCourse(userId, salesId)).ok, true);
});

test('возврат продления не возвращает истёкший старый заказ: доступ закрывается', async () => {
  const userId = await newUser();
  const old = await createOrder(input(), { consents: prepared, userId });
  assert.ok((await markPaid(old.id, adminId)).ok);
  // старый заказ оплачен 400 дней назад, его срок (365) истёк
  const longAgo = Date.now() - 400 * DAY_MS;
  await db.sql`UPDATE orders SET paid_at = ${longAgo} WHERE id = ${old.id}`;
  await db.sql`UPDATE enrollments SET expires_at = ${longAgo + 365 * DAY_MS} WHERE user_id = ${userId} AND course_id = ${salesId}`;
  assert.equal((await canAccessCourse(userId, salesId)).reason, 'expired');

  const renewal = await createOrder(input(), { consents: prepared, userId });
  assert.ok((await markPaid(renewal.id, adminId)).ok);
  assert.equal((await canAccessCourse(userId, salesId)).ok, true);

  const res = await refundOrder(renewal.id, adminId);
  assert.equal(res.ok && res.accessRevoked, true);
  assert.equal(res.ok && res.accessMovedTo, undefined);
  assert.equal((await canAccessCourse(userId, salesId)).ok, false, 'истёкший заказ доступ не продлевает');
});

test('гонка возврата и оплаты: фильтр orderId — внутри UPDATE, чужой доступ не отзывается', async () => {
  const userId = await newUser();
  const a = await createOrder(input(), { consents: prepared, userId });
  const b = await legacyDuplicate(a.id);
  assert.ok((await markPaid(a.id, adminId)).ok);

  const [paidB, refundA] = await Promise.all([markPaid(b.id, adminId), refundOrder(a.id, adminId)]);
  assert.ok(paidB.ok && refundA.ok);
  const e = await getEnrollment(userId, salesId);
  assert.equal(e?.orderId, b.id);
  assert.equal((await canAccessCourse(userId, salesId)).ok, true, 'доступ по B остался');

  // прямой отзыв с фильтром чужого заказа ничего не делает
  assert.equal(await revokeEnrollment(userId, salesId, adminId, undefined, { orderId: a.id }), false);
  assert.equal((await canAccessCourse(userId, salesId)).ok, true);
});

test('отменённый заказ нельзя оплатить; отмена доступ не выдаёт', async () => {
  const userId = await newUser();
  const created = await createOrder(input(), { consents: prepared, userId });
  const res = await cancelOrder(created.id, adminId);
  assert.equal(res.ok, true);
  assert.equal((await order(created.id)).status, 'cancelled');
  assert.deepEqual(await markPaid(created.id, adminId), { ok: false, reason: 'not_pending', status: 'cancelled' });
  assert.deepEqual(await refundOrder(created.id, adminId), { ok: false, reason: 'not_paid', status: 'cancelled' });
  assert.equal((await canAccessCourse(userId, salesId)).ok, false);
  assert.deepEqual(await cancelOrder('no-such-order', adminId), { ok: false, reason: 'not_found' });
  assert.deepEqual(await markPaid('no-such-order', adminId), { ok: false, reason: 'not_found' });
});

test('номер заказа: при совпадении берутся новые цифры, исчерпание — понятная ошибка', async () => {
  const first = await createOrder(input(), { consents: prepared, userId: await newUser(), digits: () => 42 });
  assert.ok(first.number.endsWith('-0042'));
  const seqDigits = [42, 42, 43];
  const second = await createOrder(input(), { consents: prepared, userId: await newUser(), digits: () => seqDigits.shift() as number });
  assert.ok(second.number.endsWith('-0043'));
  await assert.rejects(
    createOrder(input(), { consents: prepared, userId: await newUser(), digits: () => 42, maxAttempts: 3 }),
    (e) => e instanceof OrderError && e.code === 'number_exhausted',
  );
});

test('выборки для страниц: заказ по номеру с курсом, фильтр и счётчики админки', async () => {
  const created = await createOrder(
    input({
      buyerType: 'company',
      companyName: 'ТОО «Тест»',
      companyBin: '980101400008',
      paymentMethod: 'invoice',
    }),
    { consents: prepared, userId: await newUser() },
  );
  const view = await getOrderByNumber(created.number);
  assert.ok(view);
  assert.equal(view.courseSlug, 'sales-doubling');
  assert.equal(view.courseTitle.ru, 'Удвоение личных продаж');
  assert.equal(view.accessDays, 365);
  assert.equal(view.companyBin, '980101400008');
  const demo = await getOrderByNumber('DEMO-1003');
  assert.equal(demo?.status, 'pending');
  assert.equal(demo?.accessDays, 365, 'срок в демо-заказе — снимок предложения «Целины»');

  const pending = await listOrders('pending');
  assert.ok(pending.length > 0 && pending.every((o) => o.status === 'pending'));
  assert.ok(pending.some((o) => o.number === created.number));
  const stats = await orderStats();
  const all = await listOrders('all');
  assert.equal(stats.pending.count + stats.paid.count + stats.cancelled.count + stats.refunded.count, all.length);
  assert.equal(stats.pending.count, pending.length);
});

test('согласия пишутся только для нового заказа: повтор формы не создаёт ни второй заказ, ни вторые согласия', async () => {
  const userId = await newUser();
  const first = await createOrder(input(), { userId, consents: prepared });
  const again = await createOrder(input(), { userId, consents: prepared });
  assert.deepEqual([again.id, again.existing], [first.id, true]);
  const rows = await db.sql<{ orderId: string }>`SELECT order_id FROM consents WHERE user_id = ${userId}`;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.orderId === first.id));
});

test('согласия привязаны к владельцу из сессии, а не к email формы или чужому аккаунту', async () => {
  const owner = await newUser('owner.consent@example.kz');
  const other = await newUser('other.consent@example.kz');
  const created = await createOrder(input({ email: 'other.consent@example.kz' }), { userId: owner, consents: prepared });
  const rows = await db.sql<{ userId: string }>`SELECT user_id FROM consents WHERE order_id = ${created.id}`;
  assert.deepEqual(rows.map((r) => r.userId), [owner, owner]);
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM consents WHERE user_id = ${other}`;
  assert.equal(n?.n, 0);
});

test('неполный набор согласий: заказ не создаётся', async () => {
  const userId = await newUser();
  const before = await count(db.sql`SELECT count(*) AS n FROM orders`);
  for (const bad of [[], prepared.slice(0, 1), [...prepared, ...prepared]]) {
    await assert.rejects(createOrder(input(), { userId, consents: bad }), /ORDER_CONSENTS_INVALID/);
  }
  assert.equal(await count(db.sql`SELECT count(*) AS n FROM orders`), before);
});

test('FEATURE_LEGAL=0: согласия легаси — версия 2026-10-19, без хэша, языка и контекста текста', async () => {
  process.env.FEATURE_LEGAL = '0';
  try {
    const legacy = await prepareConsents(CHECKOUT_CONSENTS, 'ru');
    const userId = await newUser();
    const created = await createOrder(input(), { userId, consents: legacy });
    const rows = await db.sql<{ kind: string; version: string; locale: string | null; textSha256: string | null; context: string | null }>`
      SELECT kind, version, locale, text_sha256, context FROM consents WHERE order_id = ${created.id} ORDER BY kind`;
    assert.deepEqual(
      rows.map((r) => [r.kind, r.version, r.locale, r.textSha256]),
      [
        ['offer', '2026-10-19', null, null],
        ['pd_processing', '2026-10-19', null, null],
      ],
    );
  } finally {
    delete process.env.FEATURE_LEGAL;
  }
});
