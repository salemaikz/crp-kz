import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  canAccessCourse,
  canSelfEnroll,
  DAY_MS,
  enroll,
  getEnrollment,
  listEnrollments,
  revokeEnrollment,
} from '../../src/lib/access';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;

async function course(id: string, o: { visibility?: string; owner?: string | null; status?: string; price?: number | null; active?: boolean } = {}) {
  await db.sql`
    INSERT INTO courses (id, slug, title, visibility, owner_org_id, status, created_at, updated_at)
    VALUES (${id}, ${id}, ${db.json({ ru: id })}, ${o.visibility ?? 'public'}, ${o.owner ?? null},
            ${o.status ?? 'published'}, 1, 1)`;
  if (o.price !== undefined && o.price !== null) {
    await db.sql`
      INSERT INTO course_offers (id, course_id, price_kzt, access_days, active, created_at)
      VALUES (${'offer-' + id}, ${id}, ${o.price}, 365, ${o.active ?? true}, 1)`;
  }
}

async function auditCount(action: string): Promise<number> {
  const [r] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM audit_log WHERE action = ${action}`;
  return r?.n ?? 0;
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES
    ('orgA', 'crp', 'ЦРП', 'owner', 1), ('orgB', 'client', 'Клиент', 'client', 1)`;
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES
    ('uA', 'a@x.kz', 'A', 1), ('uB', 'b@x.kz', 'B', 1), ('uC', 'c@x.kz', 'C', 1), ('adm', 'adm@x.kz', 'Adm', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES
    ('orgA', 'uA', 'member', 1), ('orgB', 'uB', 'manager', 1)`;
  await course('free');
  await course('zero', { price: 0 });
  await course('inactivePaid', { price: 5000, active: false });
  await course('paid', { price: 99000 });
  await course('internalA', { visibility: 'internal', owner: 'orgA' });
  await course('private', { visibility: 'private' });
  await course('draftFree', { status: 'draft' });
});
after(async () => {
  await db.close();
});

test('canSelfEnroll: бесплатный public, цена 0, своя организация — да', async () => {
  assert.equal(await canSelfEnroll('uA', { id: 'free' }), true);
  assert.equal(await canSelfEnroll('uA', { id: 'zero' }), true);
  assert.equal(await canSelfEnroll('uA', { id: 'inactivePaid' }), true);
  assert.equal(await canSelfEnroll('uA', { id: 'internalA' }), true);
});

test('canSelfEnroll: платный, internal чужой организации, private, черновик — нет', async () => {
  assert.equal(await canSelfEnroll('uA', { id: 'paid' }), false);
  assert.equal(await canSelfEnroll('uB', { id: 'internalA' }), false);
  assert.equal(await canSelfEnroll('uC', { id: 'internalA' }), false);
  assert.equal(await canSelfEnroll('uA', { id: 'private' }), false);
  assert.equal(await canSelfEnroll('uA', { id: 'draftFree' }), false);
  assert.equal(await canSelfEnroll('uA', { id: 'missing' }), false);
  // поля аргумента не влияют — данные берутся из БД
  assert.equal(await canSelfEnroll('uB', { id: 'internalA', visibility: 'public', status: 'published' }), false);
});

test('enroll self на платный или чужой internal курс запрещён', async () => {
  await assert.rejects(enroll({ userId: 'uA', courseId: 'paid', source: 'self' }), /SELF_ENROLL_FORBIDDEN/);
  await assert.rejects(enroll({ userId: 'uB', courseId: 'internalA', source: 'self' }), /SELF_ENROLL_FORBIDDEN/);
  assert.equal((await canAccessCourse('uA', 'paid')).reason, 'none');
  assert.equal((await canAccessCourse('uB', 'internalA')).ok, false);
});

test('без зачисления — none; self на бесплатный — доступ', async () => {
  assert.deepEqual(await canAccessCourse('uC', 'free'), { ok: false, reason: 'none' });
  const e = await enroll({ userId: 'uC', courseId: 'free', source: 'self' });
  assert.equal(e.source, 'self');
  assert.equal(e.expiresAt, null);
  const res = await canAccessCourse('uC', 'free');
  assert.equal(res.ok, true);
  assert.equal(res.enrollment?.id, e.id);
});

test('enroll идемпотентен: та же строка и срок, один grant в журнале', async () => {
  await db.sql`
    INSERT INTO orders (id, number, course_id, amount_kzt, status, buyer_type, buyer_name, buyer_email, buyer_phone,
                        payment_method, created_at, updated_at)
    VALUES ('ord1', 'N-1', 'paid', 99000, 'paid', 'person', 'A', 'a@x.kz', '+7', 'kaspi', 1, 1)`;
  const before = await auditCount('enrollment.grant');
  const input = { userId: 'uA', courseId: 'paid', source: 'purchase' as const, orderId: 'ord1', grantedBy: 'adm', accessDays: 365 };
  const a = await enroll(input);
  const b = await enroll(input);
  const c = await enroll(input);
  assert.equal(a.id, b.id);
  assert.deepEqual(c, a);
  const rows = await db.sql`SELECT id FROM enrollments WHERE user_id = 'uA' AND course_id = 'paid'`;
  assert.equal(rows.length, 1);
  assert.ok(a.expiresAt && a.expiresAt > Date.now() + 364 * DAY_MS);
  assert.equal(a.orderId, 'ord1');
  assert.equal((await auditCount('enrollment.grant')) - before, 1);
  assert.equal((await canAccessCourse('uA', 'paid')).ok, true);
});

test('параллельные enroll не создают дублей', async () => {
  const all = await Promise.all(
    Array.from({ length: 5 }, () => enroll({ userId: 'uC', courseId: 'paid', source: 'grant', grantedBy: 'adm' })),
  );
  assert.equal(new Set(all.map((e) => e.id)).size, 1);
});

test('истёкший доступ — expired; повторное зачисление продлевает', async () => {
  await enroll({ userId: 'uB', courseId: 'paid', source: 'purchase', accessDays: 30 });
  await db.sql`UPDATE enrollments SET expires_at = ${Date.now() - 1000} WHERE user_id = 'uB' AND course_id = 'paid'`;
  const res = await canAccessCourse('uB', 'paid');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'expired');
  assert.ok(res.enrollment);
  const again = await enroll({ userId: 'uB', courseId: 'paid', source: 'purchase', accessDays: 30 });
  assert.ok(again.expiresAt! > Date.now() + 29 * DAY_MS);
  assert.equal((await canAccessCourse('uB', 'paid')).ok, true);
});

test('бессрочный доступ не сокращается новым сроком', async () => {
  await enroll({ userId: 'uA', courseId: 'internalA', source: 'assignment', orgId: 'orgA', dueAt: 123 });
  const e = await enroll({ userId: 'uA', courseId: 'internalA', source: 'grant', accessDays: 10 });
  assert.equal(e.expiresAt, null);
  assert.equal(e.dueAt, 123); // не передан — сохраняется
  assert.equal(e.orgId, 'orgA');
});

test('отзыв: revoked, идемпотентно; повторное зачисление снимает отзыв', async () => {
  const before = await auditCount('enrollment.revoke');
  await revokeEnrollment('uA', 'paid', 'adm');
  await revokeEnrollment('uA', 'paid', 'adm');
  assert.equal((await auditCount('enrollment.revoke')) - before, 1);
  const res = await canAccessCourse('uA', 'paid');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'revoked');
  const [log] = await db.sql<{ actorId: string; meta: { courseId: string } }>`
    SELECT actor_id, meta FROM audit_log WHERE action = 'enrollment.revoke' ORDER BY created_at DESC LIMIT 1`;
  assert.equal(log?.actorId, 'adm');
  assert.equal(log?.meta.courseId, 'paid');
  const e = await enroll({ userId: 'uA', courseId: 'paid', source: 'grant', grantedBy: 'adm' });
  assert.equal(e.revokedAt, null);
  assert.equal((await canAccessCourse('uA', 'paid')).ok, true);
  await revokeEnrollment('nobody', 'paid', 'adm'); // нет зачисления — без ошибки
});

test('enroll внутри внешней транзакции откатывается вместе с ней', async () => {
  await assert.rejects(
    db.tx(async (sql) => {
      await enroll({ userId: 'uC', courseId: 'zero', source: 'self' }, sql);
      assert.equal((await canAccessCourse('uC', 'zero', sql)).ok, true);
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(await getEnrollment('uC', 'zero'), null);
});

test('listEnrollments и getEnrollment', async () => {
  const list = await listEnrollments('uA');
  assert.deepEqual(new Set(list.map((e) => e.courseId)), new Set(['paid', 'internalA']));
  for (const e of list) {
    assert.equal(typeof e.createdAt, 'number');
    assert.equal(e.userId, 'uA');
  }
  assert.equal((await getEnrollment('uA', 'free')), null);
});
