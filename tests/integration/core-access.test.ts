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

test('canSelfEnroll: бесплатный public (нет offer или цена 0), своя организация — да', async () => {
  assert.equal(await canSelfEnroll('uA', { id: 'free' }), true);
  assert.equal(await canSelfEnroll('uA', { id: 'zero' }), true);
  assert.equal(await canSelfEnroll('uA', { id: 'internalA' }), true);
});

test('canSelfEnroll: платный (в т. ч. с неактивным offer), internal чужой организации, private, черновик — нет', async () => {
  assert.equal(await canSelfEnroll('uA', { id: 'paid' }), false);
  // продажи на паузе не делают платный курс бесплатным
  assert.equal(await canSelfEnroll('uA', { id: 'inactivePaid' }), false);
  await assert.rejects(enroll({ userId: 'uA', courseId: 'inactivePaid', source: 'self' }), /SELF_ENROLL_FORBIDDEN/);
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

test('бессрочный доступ не сокращается новым сроком; привязки прежнего источника не переносятся', async () => {
  await enroll({ userId: 'uA', courseId: 'internalA', source: 'assignment', orgId: 'orgA', dueAt: 123, grantedBy: 'uB' });
  const e = await enroll({ userId: 'uA', courseId: 'internalA', source: 'grant', accessDays: 10 });
  assert.equal(e.expiresAt, null);
  assert.equal(e.source, 'grant');
  // новая выдача заменяет источник целиком: org/due/grantedBy прежнего назначения — null
  assert.equal(e.dueAt, null);
  assert.equal(e.orgId, null);
  assert.equal(e.grantedBy, null);
  // назначение обратно: org и срок выполнения из input
  const back = await enroll({ userId: 'uA', courseId: 'internalA', source: 'assignment', orgId: 'orgA', dueAt: 456 });
  assert.equal(back.orgId, 'orgA');
  assert.equal(back.dueAt, 456);
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

// ---------- Разбор ревью: повтор заказа, смешение источников, фильтры отзыва, accessDays ----------

let orderSeq = 100;
async function paidOrder(courseId: string): Promise<string> {
  const id = `ord-${++orderSeq}`;
  await db.sql`
    INSERT INTO orders (id, number, course_id, amount_kzt, status, buyer_type, buyer_name, buyer_email, buyer_phone,
                        payment_method, created_at, updated_at)
    VALUES (${id}, ${'N-' + orderSeq}, ${courseId}, 99000, 'paid', 'person', 'X', 'x@x.kz', '+7', 'kaspi', 1, 1)`;
  return id;
}
async function user(id: string) {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES (${id}, ${id + '@x.kz'}, ${id}, 1)`;
}

test('возврат → повтор того же заказа → доступа нет (отзыв не снимается, журнал не пишется)', async () => {
  await user('uR1');
  const ord = await paidOrder('paid');
  const input = { userId: 'uR1', courseId: 'paid', source: 'purchase' as const, orderId: ord, grantedBy: 'adm', accessDays: 365 };
  await enroll(input);
  await revokeEnrollment('uR1', 'paid', 'adm', undefined, { orderId: ord });
  assert.equal((await canAccessCourse('uR1', 'paid')).reason, 'revoked');
  const grants = await auditCount('enrollment.grant');
  const replay = await enroll(input);
  assert.notEqual(replay.revokedAt, null);
  assert.equal((await canAccessCourse('uR1', 'paid')).reason, 'revoked');
  assert.equal(await auditCount('enrollment.grant'), grants);
  // новый заказ — это новая выдача: доступ возвращается
  const ord2 = await paidOrder('paid');
  const fresh = await enroll({ ...input, orderId: ord2 });
  assert.equal(fresh.revokedAt, null);
  assert.equal(fresh.orderId, ord2);
  assert.equal((await canAccessCourse('uR1', 'paid')).ok, true);
});

test('истёк → повтор того же заказа → срок не меняется', async () => {
  await user('uR2');
  const ord = await paidOrder('paid');
  const input = { userId: 'uR2', courseId: 'paid', source: 'purchase' as const, orderId: ord, accessDays: 30 };
  await enroll(input);
  const past = Date.now() - 1000;
  await db.sql`UPDATE enrollments SET expires_at = ${past} WHERE user_id = 'uR2' AND course_id = 'paid'`;
  const replay = await enroll(input);
  assert.equal(replay.expiresAt, past);
  assert.equal((await canAccessCourse('uR2', 'paid')).reason, 'expired');
  // действующее зачисление: повтор того же заказа тоже не продлевает
  await db.sql`UPDATE enrollments SET expires_at = ${Date.now() + DAY_MS} WHERE user_id = 'uR2' AND course_id = 'paid'`;
  const before = await getEnrollment('uR2', 'paid');
  assert.deepEqual(await enroll(input), before);
});

test('заказ B после заказа A: возврат A не отзывает доступ по B; возврат B — отзывает', async () => {
  await user('uR3');
  const a = await paidOrder('paid');
  const b = await paidOrder('paid');
  await enroll({ userId: 'uR3', courseId: 'paid', source: 'purchase', orderId: a, accessDays: 30 });
  const e = await enroll({ userId: 'uR3', courseId: 'paid', source: 'purchase', orderId: b, accessDays: 365 });
  assert.equal(e.orderId, b);
  assert.ok(e.expiresAt! > Date.now() + 364 * DAY_MS, 'покупка продлевает до max(текущий, новый)');
  await revokeEnrollment('uR3', 'paid', 'adm', undefined, { orderId: a });
  assert.equal((await canAccessCourse('uR3', 'paid')).ok, true);
  await revokeEnrollment('uR3', 'paid', 'adm', undefined, { orderId: b });
  assert.equal((await canAccessCourse('uR3', 'paid')).reason, 'revoked');
  const [log] = await db.sql<{ meta: { orderId?: string } }>`
    SELECT meta FROM audit_log WHERE action = 'enrollment.revoke' ORDER BY created_at DESC, id LIMIT 1`;
  assert.equal(log?.meta.orderId, b);
});

test('назначение поверх покупки: срок не сокращается, возврат заказа доступ не отзывает', async () => {
  await user('uR4');
  const ord = await paidOrder('paid');
  const bought = await enroll({ userId: 'uR4', courseId: 'paid', source: 'purchase', orderId: ord, accessDays: 365 });
  const assigned = await enroll({ userId: 'uR4', courseId: 'paid', source: 'assignment', orgId: 'orgA', accessDays: 10, dueAt: 77 });
  assert.equal(assigned.expiresAt, bought.expiresAt, 'назначение не обрезает более длинный купленный доступ');
  assert.equal(assigned.orderId, null);
  assert.equal(assigned.orgId, 'orgA');
  await revokeEnrollment('uR4', 'paid', 'adm', undefined, { orderId: ord });
  assert.equal((await canAccessCourse('uR4', 'paid')).ok, true);
});

test('отзыв по организации: только при совпадении org_id и source assignment/self/seat', async () => {
  await user('uR5');
  await enroll({ userId: 'uR5', courseId: 'internalA', source: 'assignment', orgId: 'orgA' });
  await revokeEnrollment('uR5', 'internalA', 'adm', undefined, { orgId: 'orgB' });
  assert.equal((await canAccessCourse('uR5', 'internalA')).ok, true, 'чужая организация — не отзывает');
  await revokeEnrollment('uR5', 'internalA', 'adm', undefined, { orgId: 'orgA' });
  assert.equal((await canAccessCourse('uR5', 'internalA')).reason, 'revoked');

  // доступ, выданный админом с org_id организации (source grant), уход из организации не трогает
  await user('uR6');
  await enroll({ userId: 'uR6', courseId: 'internalA', source: 'grant', orgId: 'orgA', grantedBy: 'adm' });
  await revokeEnrollment('uR6', 'internalA', 'adm', undefined, { orgId: 'orgA' });
  assert.equal((await canAccessCourse('uR6', 'internalA')).ok, true);
  // без фильтра — отзывается любой источник
  await revokeEnrollment('uR6', 'internalA', 'adm');
  assert.equal((await canAccessCourse('uR6', 'internalA')).reason, 'revoked');
});

test('accessDays: только целое > 0 или null/undefined, иначе RangeError', async () => {
  await user('uR7');
  for (const bad of [0, -1, 0.3333333, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e15]) {
    await assert.rejects(
      enroll({ userId: 'uR7', courseId: 'paid', source: 'grant', accessDays: bad }),
      (e: unknown) => e instanceof RangeError,
      String(bad),
    );
  }
  assert.equal(await getEnrollment('uR7', 'paid'), null);
  assert.equal((await enroll({ userId: 'uR7', courseId: 'paid', source: 'grant', accessDays: null })).expiresAt, null);
  const e = await enroll({ userId: 'uR7', courseId: 'free', source: 'grant', accessDays: 1 });
  assert.ok(e.expiresAt! > Date.now() + DAY_MS - 60_000 && e.expiresAt! <= Date.now() + DAY_MS);
});

test('canSelfEnroll: internal своей организации с платным offer — нет', async () => {
  await course('internalPaid', { visibility: 'internal', owner: 'orgA', price: 1000, active: false });
  assert.equal(await canSelfEnroll('uA', { id: 'internalPaid' }), false);
});

test('журнал enrollment.grant: явный expiresAt пишется им самим, а не как accessDays: null (бессрочно)', async () => {
  await user('uR8');
  const until = Date.now() + 10 * DAY_MS;
  const moved = await enroll({ userId: 'uR8', courseId: 'paid', source: 'purchase', orderId: await paidOrder('paid'), expiresAt: until });
  assert.equal(moved.expiresAt, until);
  const [row] = await db.sql<{ meta: Record<string, unknown> }>`
    SELECT meta FROM audit_log WHERE action = 'enrollment.grant' AND entity_id = ${moved.id}`;
  assert.equal(row?.meta.expiresAt, until);
  assert.equal('accessDays' in (row?.meta ?? {}), false, 'accessDays не пишется — иначе срок читался бы как бессрочный');

  // явный бессрочный тоже пишется явно; обычная выдача — по-прежнему accessDays
  await user('uR9');
  const forever = await enroll({ userId: 'uR9', courseId: 'paid', source: 'purchase', orderId: await paidOrder('paid'), expiresAt: null });
  const [f] = await db.sql<{ meta: Record<string, unknown> }>`
    SELECT meta FROM audit_log WHERE action = 'enrollment.grant' AND entity_id = ${forever.id}`;
  assert.equal(f?.meta.expiresAt, null);
  assert.equal('accessDays' in (f?.meta ?? {}), false);
  const days = await enroll({ userId: 'uR9', courseId: 'free', source: 'grant', accessDays: 7 });
  const [d] = await db.sql<{ meta: Record<string, unknown> }>`
    SELECT meta FROM audit_log WHERE action = 'enrollment.grant' AND entity_id = ${days.id}`;
  assert.equal(d?.meta.accessDays, 7);
  assert.equal('expiresAt' in (d?.meta ?? {}), false);
});
