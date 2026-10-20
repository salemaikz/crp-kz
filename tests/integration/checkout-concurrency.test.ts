import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { canAccessCourse, getEnrollment } from '../../src/lib/access';
import { newId } from '../../src/lib/db';
import { seed, seedUserId } from '../../src/lib/db/seed';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { CHECKOUT_CONSENTS, prepareConsents, type PreparedConsent } from '../../src/lib/legal';
import { markPaid, refundOrder } from '../../src/lib/orders/admin';
import { createOrder } from '../../src/lib/orders/create';
import type { CheckoutInput } from '../../src/lib/orders/validation';

// Гонки заказов на настоящем Postgres: параллельные транзакции идут в разных соединениях пула,
// поэтому здесь проверяются блокировки (SELECT … FOR UPDATE). PGlite — одно соединение, гонок там
// не бывает, поэтому без TEST_DATABASE_URL тесты пропускаются (CI гоняет их на Postgres 16).

const PG = Boolean(process.env.TEST_DATABASE_URL?.trim());
const skip = PG ? false : 'нужен настоящий Postgres: TEST_DATABASE_URL';

let db: TestDb;
let salesId: string;
/** Подготовленные согласия (в тестах LEGAL активен: демо). */
let prepared: PreparedConsent[];
const adminId = seedUserId('admin@crp.demo');

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

async function newUser(): Promise<string> {
  const id = newId();
  await db.sql`INSERT INTO users (id, email, password_hash, name, role, locale, email_verified_at, created_at)
               VALUES (${id}, ${`race-${id}@example.kz`}, 'x', 'Пользователь', 'learner', 'ru', 1, 1)`;
  return id;
}

/** Второй оплаченный заказ на тот же курс (как дубль до D-020): копия заказа в pending. */
async function duplicate(of: string): Promise<string> {
  const id = newId();
  await db.sql`
    INSERT INTO orders (id, number, user_id, course_id, amount_kzt, access_days, status, buyer_type, buyer_name,
                        buyer_email, buyer_phone, payment_method, created_at, updated_at)
    SELECT ${id}, ${`CRP-RACE-${String(++seq).padStart(5, '0')}`}, user_id, course_id, amount_kzt, access_days,
           'pending', buyer_type, buyer_name, buyer_email, buyer_phone, payment_method, created_at + 1, updated_at + 1
    FROM orders WHERE id = ${of}`;
  return id;
}

before(async () => {
  if (!PG) return;
  db = await createTestDb();
  await seed(db);
  const [row] = await db.sql<{ id: string }>`SELECT id FROM courses WHERE slug = 'sales-doubling'`;
  salesId = row?.id as string;
  assert.ok(salesId);
  prepared = await prepareConsents(CHECKOUT_CONSENTS, 'ru');
  assert.equal(db.driver, 'postgres');
});
after(async () => {
  if (db) await db.close();
});

test('createOrder: два пользователя впервые принимают один текст одновременно — оба заказа, по одной строке legal_texts', { skip }, async () => {
  const [before] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM legal_texts`;
  assert.equal(Number(before?.n), 0, 'до первого заказа копий текстов нет');
  const users = await Promise.all([newUser(), newUser(), newUser(), newUser()]);
  const created = await Promise.all(users.map((userId) => createOrder(input(), { userId, consents: prepared })));
  assert.equal(new Set(created.map((o) => o.id)).size, 4);
  const texts = await db.sql<{ sha256: string }>`SELECT sha256 FROM legal_texts`;
  assert.equal(texts.length, 2, 'оферта и согласие на ПДн — по одной строке');
  assert.equal(new Set(texts.map((t) => t.sha256)).size, 2);
  const [c] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM consents WHERE text_sha256 IS NOT NULL`;
  assert.equal(Number(c?.n), 8, 'у каждого заказа по два согласия');
});

test('createOrder: параллельные заказы одного пользователя — один заказ, все получают его', { skip }, async () => {
  for (let trial = 0; trial < 5; trial++) {
    const userId = await newUser();
    const all = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createOrder(input({ paymentMethod: i % 2 ? 'invoice' : 'kaspi' }), { userId, consents: prepared }),
      ),
    );
    assert.equal(new Set(all.map((o) => o.id)).size, 1, `попытка ${trial}: один заказ`);
    assert.equal(all.filter((o) => !o.existing).length, 1, 'создан ровно один раз');
    const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM orders WHERE user_id = ${userId}`;
    assert.equal(Number(n?.n), 1);
  }
});

test('refundOrder: одновременные возвраты двух оплаченных заказов — доступ закрыт, не переехал на возвращённый', { skip }, async () => {
  for (let trial = 0; trial < 25; trial++) {
    const userId = await newUser();
    const a = await createOrder(input(), { userId, consents: prepared });
    const b = await duplicate(a.id);
    assert.ok((await markPaid(a.id, adminId)).ok);
    assert.ok((await markPaid(b, adminId)).ok);
    assert.equal((await getEnrollment(userId, salesId))?.orderId, b); // доступ держится на B

    const [ra, rb] = await Promise.all([refundOrder(a.id, adminId), refundOrder(b, adminId)]);
    assert.ok(ra.ok && rb.ok, `попытка ${trial}: оба возврата прошли`);
    const statuses = await db.sql<{ status: string }>`SELECT status FROM orders WHERE user_id = ${userId}`;
    assert.deepEqual(statuses.map((s) => s.status), ['refunded', 'refunded']);
    // оплаченных заказов не осталось — доступа быть не должно
    const e = await getEnrollment(userId, salesId);
    assert.notEqual(e?.revokedAt, null, `попытка ${trial}: доступ отозван (держался на ${e?.orderId === a.id ? 'A' : 'B'})`);
    assert.equal((await canAccessCourse(userId, salesId)).ok, false);
    // ровно один из возвратов закрыл доступ. Перенос возможен, только если второй возврат шёл строго
    // после (тогда он и закрыл доступ) — перенос на уже возвращённый заказ блокировка исключает
    assert.equal([ra, rb].filter((r) => r.ok && r.accessRevoked).length, 1);
  }
});

test('refundOrder: одновременные возвраты одного заказа — один успех, второй not_paid', { skip }, async () => {
  const userId = await newUser();
  const a = await createOrder(input(), { userId, consents: prepared });
  assert.ok((await markPaid(a.id, adminId)).ok);
  const results = await Promise.all(Array.from({ length: 4 }, () => refundOrder(a.id, adminId)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'not_paid'));
  const [n] = await db.sql<{ n: number }>`
    SELECT count(*) AS n FROM audit_log WHERE action = 'order.refund' AND entity_id = ${a.id}`;
  assert.equal(Number(n?.n), 1);
});
