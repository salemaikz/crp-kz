import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { after, before, test } from 'node:test';
import { canAccessCourse } from '../../src/lib/access';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../src/lib/auth/demo';
import { getMemberships, isManagerOf } from '../../src/lib/auth/index';
import { seedId } from '../../src/lib/content/ids';
import type { LessonContent, SeedCourse, SeedLesson } from '../../src/lib/content/types';
import { seedCourses } from '../../src/lib/db/seed/run';
import { seedOrgId, seedUserId } from '../../src/lib/db/seed/people';
import { seedBase } from '../../src/lib/db/seed/time';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);

function lesson(slug: string, withQuiz: boolean): SeedLesson {
  const content: LessonContent = {
    ru: {
      v: 1,
      blocks: [
        { id: 'h', type: 'heading', level: 2, text: `Урок ${slug}` },
        { id: 't', type: 'text', markdown: 'Текст урока (демо).' },
        ...(withQuiz
          ? [
              {
                id: 'quiz',
                type: 'quiz' as const,
                passScore: 70,
                questions: [
                  { id: 'q1', text: 'Да?', options: ['Да', 'Нет'], correct: [0], multiple: false },
                  { id: 'q2', text: 'Нет?', options: ['Да', 'Нет'], correct: [1], multiple: false },
                  { id: 'q3', text: 'Оба?', options: ['A', 'B', 'C'], correct: [0, 1], multiple: true },
                ],
              },
            ]
          : []),
      ],
    },
  };
  return { slug, title: { ru: `Урок ${slug}` }, durationMin: 10, content };
}

function fixture(slug: string, o: Partial<SeedCourse>): SeedCourse {
  return {
    id: seedId('course', slug),
    slug,
    title: { ru: slug },
    summary: { ru: 'Кратко' },
    description: { ru: 'Описание' },
    level: 'start',
    durationMin: 60,
    visibility: 'public',
    ownerOrg: null,
    priceKzt: null,
    accessDays: null,
    sequential: false,
    modules: [
      { title: { ru: 'Модуль 1' }, lessons: [lesson('l1', false), lesson('l2', true)] },
      { title: { ru: 'Модуль 2' }, lessons: [lesson('l3', true), lesson('l4', false)] },
    ],
    ...o,
  };
}

const COURSES: SeedCourse[] = [
  fixture('tselina-test', { title: { ru: 'Целина (тест)' }, priceKzt: 99000, accessDays: 365 }),
  fixture('sales-test', { title: { ru: 'Продажи (тест)' }, priceKzt: 49000 }),
  fixture('free-test', { title: { ru: 'Бесплатный (тест)' } }),
  fixture('operator-test', { title: { ru: 'Оператор (тест)' }, visibility: 'internal', ownerOrg: 'crp' }),
];
const [TSELINA, SALES, FREE, INTERNAL] = COURSES as [SeedCourse, SeedCourse, SeedCourse, SeedCourse];

let db: TestDb;
before(async () => {
  db = await createTestDb();
  const res = await seedCourses(db, COURSES, { nowMs: NOW });
  assert.equal(res.seeded, true);
});
after(async () => {
  await db.close();
});

test('4 демо-аккаунта с паролем demo12345 и детерминированными id', async () => {
  for (const a of DEMO_ACCOUNTS) {
    const [u] = await db.sql<{ id: string; role: string; passwordHash: string; name: string; emailVerifiedAt: number | null }>`
      SELECT id, role, password_hash, name, email_verified_at FROM users WHERE email = ${a.email}`;
    assert.ok(u, a.email);
    assert.equal(typeof u.emailVerifiedAt, 'number', 'email демо-пользователя подтверждён');
    assert.equal(u.id, seedUserId(a.email));
    assert.equal(u.role, a.role === 'admin' ? 'admin' : 'learner');
    assert.equal(u.name, a.name);
    assert.equal(await bcrypt.compare(DEMO_PASSWORD, u.passwordHash), true);
  }
});

test('организация ЦРП: руководитель, оператор и ещё 5 сотрудников', async () => {
  const [org] = await db.sql<{ id: string; kind: string }>`SELECT id, kind FROM organizations WHERE slug = 'crp'`;
  assert.equal(org?.id, seedOrgId());
  assert.equal(org?.kind, 'owner');
  const members = await db.sql<{ role: string }>`SELECT role FROM organization_members WHERE org_id = ${seedOrgId()}`;
  assert.equal(members.length, 7);
  assert.equal(members.filter((m) => m.role === 'manager').length, 1);
  assert.equal(await isManagerOf(seedUserId('manager@crp.demo'), seedOrgId()), true);
  assert.equal(await isManagerOf(seedUserId('operator@crp.demo'), seedOrgId()), false);
  const ms = await getMemberships(seedUserId('operator@crp.demo'));
  assert.equal(ms.length, 1);
  assert.equal(ms[0]?.orgSlug, 'crp');
  assert.equal(ms[0]?.role, 'member');
  assert.equal(typeof ms[0]?.position, 'string');
  assert.deepEqual(await getMemberships(seedUserId('client@crp.demo')), []);
});

test('назначения внутреннего курса: сроки в прошлом и будущем, разный прогресс', async () => {
  const base = seedBase(NOW);
  const rows = await db.sql<{ userId: string; dueAt: number; source: string; done: number }>`
    SELECT e.user_id, e.due_at, e.source,
           (SELECT count(*) FROM lesson_progress p WHERE p.user_id = e.user_id AND p.course_id = e.course_id) AS done
    FROM enrollments e WHERE e.course_id = ${INTERNAL.id}`;
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.source === 'assignment'));
  assert.ok(rows.some((r) => r.dueAt < base), 'есть просроченные');
  assert.ok(rows.some((r) => r.dueAt > base && r.dueAt < base + 7 * 86_400_000), 'есть со сроком скоро');
  assert.ok(new Set(rows.map((r) => r.done)).size >= 3, 'разный прогресс');
  assert.ok((await canAccessCourse(seedUserId('operator@crp.demo'), INTERNAL.id)).ok);
});

test('клиент: оплаченная «Целина» с частичным прогрессом, бесплатный курс с сертификатом', async () => {
  const clientId = seedUserId('client@crp.demo');
  const access = await canAccessCourse(clientId, TSELINA.id);
  assert.equal(access.ok, true);
  assert.equal(access.enrollment?.source, 'purchase');
  const [order] = await db.sql<{ status: string; amountKzt: number; id: string }>`
    SELECT id, status, amount_kzt FROM orders WHERE user_id = ${clientId}`;
  assert.equal(order?.status, 'paid');
  assert.equal(order?.amountKzt, 99000);
  assert.equal(access.enrollment?.orderId, order?.id);
  const [p] = await db.sql<{ n: number }>`
    SELECT count(*) AS n FROM lesson_progress WHERE user_id = ${clientId} AND course_id = ${TSELINA.id}`;
  assert.ok(p && p.n > 0 && p.n < 4);
  const certs = await db.sql<{ courseId: string; number: string }>`SELECT course_id, number FROM certificates`;
  assert.equal(certs.length, 1);
  assert.equal(certs[0]?.courseId, FREE.id);
  assert.match(certs[0]?.number ?? '', /^CRP-2026-[A-Z2-9]{6}$/);
  const [fp] = await db.sql<{ n: number }>`
    SELECT count(*) AS n FROM lesson_progress WHERE user_id = ${clientId} AND course_id = ${FREE.id}`;
  assert.equal(fp?.n, 4);
  const attempts = await db.sql<{ passed: boolean }>`SELECT passed FROM quiz_attempts WHERE user_id = ${clientId}`;
  assert.ok(attempts.some((a) => a.passed) && attempts.some((a) => !a.passed));
});

test('2 ожидающих заказа: физлицо Kaspi и юрлицо по счёту', async () => {
  const rows = await db.sql<{ buyerType: string; paymentMethod: string; companyBin: string | null; courseId: string }>`
    SELECT buyer_type, payment_method, company_bin, course_id FROM orders WHERE status = 'pending' ORDER BY number`;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { buyerType: 'person', paymentMethod: 'kaspi', companyBin: null, courseId: SALES.id });
  assert.deepEqual(rows[1], { buyerType: 'company', paymentMethod: 'invoice', companyBin: '123456789012', courseId: TSELINA.id });
});

test('курсы опубликованы, у платных есть предложения, журнал заполнен', async () => {
  const courses = await db.sql<{ status: string }>`SELECT status FROM courses`;
  assert.equal(courses.length, 4);
  assert.ok(courses.every((c) => c.status === 'published'));
  const offers = await db.sql<{ courseId: string; priceKzt: number; accessDays: number | null }>`
    SELECT course_id, price_kzt, access_days FROM course_offers ORDER BY price_kzt DESC`;
  assert.deepEqual(offers, [
    { courseId: TSELINA.id, priceKzt: 99000, accessDays: 365 },
    { courseId: SALES.id, priceKzt: 49000, accessDays: null },
  ]);
  const [l] = await db.sql<{ content: LessonContent }>`
    SELECT content FROM lessons WHERE course_id = ${TSELINA.id} AND slug = 'l2'`;
  assert.deepEqual(l?.content, TSELINA.modules[0]?.lessons[1]?.content);
  const [a] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM audit_log`;
  assert.ok(a && a.n > 5);
});

test('повторный сид ничего не делает; сид детерминирован', async () => {
  assert.deepEqual(await seedCourses(db, COURSES, { nowMs: NOW }), { seeded: false });
  const other = await createTestDb({ register: false });
  try {
    await seedCourses(other, COURSES, { nowMs: NOW + 3_600_000 }); // те же сутки
    const snap = async (d: TestDb) => ({
      e: await d.sql`SELECT id, user_id, course_id, due_at, expires_at, created_at FROM enrollments ORDER BY id`,
      o: await d.sql`SELECT id, number, status, created_at, paid_at FROM orders ORDER BY id`,
      c: await d.sql`SELECT id, number, issued_at FROM certificates ORDER BY id`,
      l: await d.sql`SELECT id, module_id, position FROM lessons ORDER BY id`,
      p: await d.sql`SELECT user_id, lesson_id, completed_at FROM lesson_progress ORDER BY user_id, lesson_id`,
    });
    assert.deepEqual(await snap(other), await snap(db));
  } finally {
    await other.close();
  }
});
