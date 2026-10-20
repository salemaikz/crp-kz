// «Команда»: изоляция по организации и назначение курсов.
// Руководитель видит только сотрудников своей организации; назначить можно только члену организации,
// только назначаемый курс и только руководителю этой организации.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { enroll, getEnrollment } from '../../src/lib/access';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { listAssignableCourses } from '../../src/lib/team/assignable';
import { assignCourse, MAX_ASSIGN } from '../../src/lib/team/assign';
import { parseDueDate } from '../../src/lib/team/dates';
import { getManagedOrgs, listMembers, orgLabel, pickOrg } from '../../src/lib/team/orgs';
import { TeamError, type TeamErrorCode } from '../../src/lib/team/types';

let db: TestDb;
const DAY = 86_400_000;

async function course(
  id: string,
  o: { visibility?: string; owner?: string | null; status?: string; price?: number | null; accessDays?: number | null } = {},
) {
  await db.sql`
    INSERT INTO courses (id, slug, title, visibility, owner_org_id, status, created_at, updated_at)
    VALUES (${id}, ${id}, ${db.json({ ru: id })}, ${o.visibility ?? 'public'}, ${o.owner ?? null},
            ${o.status ?? 'published'}, 1, 1)`;
  if (o.price !== undefined && o.price !== null) {
    await db.sql`
      INSERT INTO course_offers (id, course_id, price_kzt, access_days, active, created_at)
      VALUES (${'offer-' + id}, ${id}, ${o.price}, ${o.accessDays ?? null}, true, 1)`;
  }
}

async function rejects(p: Promise<unknown>, code: TeamErrorCode) {
  await assert.rejects(p, (e: unknown) => e instanceof TeamError && e.code === code, `ожидали ${code}`);
}

async function enrollmentCount(courseId: string): Promise<number> {
  const [r] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM enrollments WHERE course_id = ${courseId}`;
  return r?.n ?? 0;
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES
    ('orgA', 'crp', 'ЦРП — Центр', 'owner', 1), ('orgB', 'client', 'ТОО Клиент', 'client', 1)`;
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES
    ('mgrA', 'mgra@x.kz', 'Руководитель А', 1), ('a1', 'a1@x.kz', 'Алия', 1), ('a2', 'a2@x.kz', 'Бекзат', 1),
    ('mgrB', 'mgrb@x.kz', 'Руководитель Б', 1), ('b1', 'b1@x.kz', 'Берик', 1),
    ('both', 'both@x.kz', 'В двух организациях', 1), ('outsider', 'out@x.kz', 'Посторонний', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, position, created_at) VALUES
    ('orgA', 'mgrA', 'manager', 'Руководитель', 1), ('orgA', 'a1', 'member', 'Оператор', 1),
    ('orgA', 'a2', 'member', NULL, 1), ('orgA', 'both', 'member', 'Консультант', 1),
    ('orgB', 'mgrB', 'manager', 'Директор', 1), ('orgB', 'b1', 'member', 'Менеджер', 1),
    ('orgB', 'both', 'manager', 'Партнёр', 1)`;

  await course('internalA', { visibility: 'internal', owner: 'orgA' });
  await course('internalB', { visibility: 'internal', owner: 'orgB' });
  await course('free');
  await course('paid', { price: 99000, accessDays: 365 });
  await course('private', { visibility: 'private' });
  await course('draft', { status: 'draft' });
  await course('draftInternal', { visibility: 'internal', owner: 'orgA', status: 'draft' });
});
after(async () => {
  await db.close();
});

// ---------- организации и сотрудники ----------

test('getManagedOrgs: только организации, где пользователь — руководитель', async () => {
  assert.deepEqual((await getManagedOrgs('mgrA')).map((o) => o.slug), ['crp']);
  assert.deepEqual((await getManagedOrgs('mgrB')).map((o) => o.slug), ['client']);
  // обычный сотрудник и посторонний — не руководители
  assert.deepEqual(await getManagedOrgs('a1'), []);
  assert.deepEqual(await getManagedOrgs('outsider'), []);
  // руководитель в одной и сотрудник в другой: видна только управляемая; свой ЦРП — первым
  assert.deepEqual((await getManagedOrgs('both')).map((o) => o.slug), ['client']);
});

test('pickOrg и orgLabel: неизвестный ?org= → первая из доступных, чужая организация не выбирается', async () => {
  const orgs = await getManagedOrgs('mgrA');
  assert.equal(pickOrg(orgs, 'crp')?.slug, 'crp');
  assert.equal(pickOrg(orgs, 'client')?.slug, 'crp'); // не руководитель в client → остаёмся в своей
  assert.equal(pickOrg(orgs, undefined)?.slug, 'crp');
  assert.equal(pickOrg([], 'crp'), null);
  assert.equal(orgLabel(orgs[0] as (typeof orgs)[number]), 'ЦРП');
  assert.equal(orgLabel({ kind: 'client', name: 'ТОО Клиент' }), 'ТОО Клиент');
});

test('listMembers: руководитель видит только сотрудников своей организации', async () => {
  const a = await listMembers('orgA');
  assert.deepEqual(a.map((m) => m.userId).sort(), ['a1', 'a2', 'both', 'mgrA']);
  const b = await listMembers('orgB');
  assert.deepEqual(b.map((m) => m.userId).sort(), ['b1', 'both', 'mgrB']);
  assert.equal(a.find((m) => m.userId === 'a1')?.position, 'Оператор');
  assert.equal(a.find((m) => m.userId === 'a2')?.position, null);
});

// ---------- какие курсы можно назначать ----------

test('назначаемые курсы: внутренние своей организации + public; чужие internal, private и черновики — нет', async () => {
  const a = (await listAssignableCourses('orgA')).map((c) => c.id);
  // ЦРП (владелец) может назначать и платные public своим сотрудникам
  assert.deepEqual(a.sort(), ['free', 'internalA', 'paid']);
  // организация-клиент: платный public — нет (иначе назначение обходит покупку), только бесплатные и свои
  const b = (await listAssignableCourses('orgB')).map((c) => c.id);
  assert.deepEqual(b.sort(), ['free', 'internalB']);
});

// ---------- назначение ----------

test('assignCourse: руководитель назначает курс сотрудникам со сроком — enrollment assignment, org_id, журнал', async () => {
  const dueAt = Date.now() + 7 * DAY;
  const res = await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'internalA', userIds: ['a1', 'a2'], dueAt });
  assert.deepEqual(res.assigned.sort(), ['a1', 'a2']);
  assert.deepEqual(res.skipped, []);
  for (const u of ['a1', 'a2']) {
    const e = await getEnrollment(u, 'internalA');
    assert.equal(e?.source, 'assignment');
    assert.equal(e?.orgId, 'orgA');
    assert.equal(e?.grantedBy, 'mgrA');
    assert.equal(e?.dueAt, dueAt);
    assert.equal(e?.revokedAt, null);
  }
  const [log] = await db.sql<{ actorId: string; meta: { orgId: string; userIds: string[]; dueAt: number } }>`
    SELECT actor_id, meta FROM audit_log WHERE action = 'team.assign' AND entity_id = 'internalA'`;
  assert.equal(log?.actorId, 'mgrA');
  assert.equal(log?.meta.orgId, 'orgA');
  assert.deepEqual(log?.meta.userIds.sort(), ['a1', 'a2']);
  assert.equal(log?.meta.dueAt, dueAt);
  // и по каждому сотруднику — enrollment.grant из access
  const [grants] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM audit_log WHERE action = 'enrollment.grant'`;
  assert.ok((grants?.n ?? 0) >= 2);
});

test('assignCourse: без срока; повторное назначение обновляет срок, дублей нет', async () => {
  await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'free', userIds: ['a1'] });
  assert.equal((await getEnrollment('a1', 'free'))?.dueAt, null);
  const dueAt = Date.now() + 3 * DAY;
  await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'free', userIds: ['a1', 'a1'], dueAt });
  assert.equal((await getEnrollment('a1', 'free'))?.dueAt, dueAt);
  assert.equal(await enrollmentCount('free'), 1);
});

test('assignCourse: платный public курс ЦРП своим сотрудникам — срок доступа из offer', async () => {
  const before = Date.now();
  await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'paid', userIds: ['a2'] });
  const e = await getEnrollment('a2', 'paid');
  assert.equal(e?.source, 'assignment');
  assert.ok(e?.expiresAt && e.expiresAt >= before + 365 * DAY - 1000);
});

test('assignCourse: сотрудник чужой организации отклоняется, никто из выбранных не получает доступ', async () => {
  const n0 = await enrollmentCount('internalA');
  await rejects(
    assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'internalA', userIds: ['a1', 'b1'] }),
    'not_member',
  );
  await rejects(assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'internalA', userIds: ['outsider'] }), 'not_member');
  await rejects(assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'internalA', userIds: ['ghost'] }), 'not_member');
  assert.equal(await getEnrollment('b1', 'internalA'), null);
  assert.equal(await enrollmentCount('internalA'), n0); // всё или ничего
});

test('assignCourse: не руководитель отклоняется (сотрудник, руководитель другой организации, посторонний)', async () => {
  await rejects(assignCourse({ actorId: 'a1', orgId: 'orgA', courseId: 'internalA', userIds: ['a2'] }), 'forbidden');
  await rejects(assignCourse({ actorId: 'mgrB', orgId: 'orgA', courseId: 'internalA', userIds: ['a2'] }), 'forbidden');
  await rejects(assignCourse({ actorId: 'outsider', orgId: 'orgA', courseId: 'internalA', userIds: ['a2'] }), 'forbidden');
  // руководитель в одной организации и просто сотрудник в другой — управлять второй не может
  await rejects(assignCourse({ actorId: 'both', orgId: 'orgA', courseId: 'internalA', userIds: ['a2'] }), 'forbidden');
  await rejects(assignCourse({ actorId: 'ghost', orgId: 'orgA', courseId: 'internalA', userIds: ['a2'] }), 'forbidden');
});

test('assignCourse: курс вне списка назначаемых отклоняется (чужой internal, private, черновик, платный для клиента)', async () => {
  const bad: Array<[string, string, string]> = [
    ['mgrA', 'orgA', 'internalB'], // internal другой организации
    ['mgrA', 'orgA', 'private'],
    ['mgrA', 'orgA', 'draft'],
    ['mgrA', 'orgA', 'draftInternal'],
    ['mgrA', 'orgA', 'missing'],
    ['mgrB', 'orgB', 'internalA'],
    ['mgrB', 'orgB', 'paid'], // клиент не может назначить платный курс в обход покупки
  ];
  for (const [actorId, orgId, courseId] of bad) {
    const userId = orgId === 'orgA' ? 'a1' : 'b1';
    await rejects(assignCourse({ actorId, orgId, courseId, userIds: [userId] }), 'course_not_assignable');
  }
  assert.equal(await getEnrollment('b1', 'paid'), null);
  // бесплатный public клиент назначить может
  await assignCourse({ actorId: 'mgrB', orgId: 'orgB', courseId: 'free', userIds: ['b1'] });
  assert.equal((await getEnrollment('b1', 'free'))?.orgId, 'orgB');
});

test('assignCourse: руководитель-совместитель назначает только в той организации, которую ведёт', async () => {
  await assignCourse({ actorId: 'both', orgId: 'orgB', courseId: 'internalB', userIds: ['b1', 'both'] });
  assert.equal((await getEnrollment('b1', 'internalB'))?.grantedBy, 'both');
  // свою «двойную» роль нельзя использовать для чужих сотрудников
  await rejects(assignCourse({ actorId: 'both', orgId: 'orgB', courseId: 'internalB', userIds: ['a1'] }), 'not_member');
});

test('assignCourse: пустой список, слишком много сотрудников, срок в прошлом', async () => {
  await rejects(assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'internalA', userIds: [] }), 'no_employees');
  const many = Array.from({ length: MAX_ASSIGN + 1 }, (_, i) => `u${i}`);
  await rejects(assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'internalA', userIds: many }), 'too_many');
  await rejects(
    assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'internalA', userIds: ['a1'], dueAt: Date.now() - DAY }),
    'due_past',
  );
});

test('assignCourse: личную покупку и выдачу админом не перезаписывает, сотрудник попадает в skipped', async () => {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('buyer', 'buyer@x.kz', 'Покупатель', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES ('orgA', 'buyer', 'member', 1)`;
  await enroll({ userId: 'buyer', courseId: 'paid', source: 'purchase', accessDays: 365 });
  const before = await getEnrollment('buyer', 'paid');
  const res = await assignCourse({
    actorId: 'mgrA',
    orgId: 'orgA',
    courseId: 'paid',
    userIds: ['buyer', 'a1'],
    dueAt: Date.now() + DAY,
  });
  assert.deepEqual(res.skipped, ['buyer']);
  assert.deepEqual(res.assigned, ['a1']);
  const after = await getEnrollment('buyer', 'paid');
  assert.equal(after?.source, 'purchase');
  assert.equal(after?.orgId, null);
  assert.equal(after?.dueAt, null);
  assert.equal(after?.expiresAt, before?.expiresAt);
});

test('assignCourse: самостоятельный доступ (self) превращается в назначение со сроком', async () => {
  await enroll({ userId: 'a2', courseId: 'free', source: 'self' });
  const dueAt = Date.now() + 2 * DAY;
  const res = await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'free', userIds: ['a2'], dueAt });
  assert.deepEqual(res.assigned, ['a2']);
  const e = await getEnrollment('a2', 'free');
  assert.equal(e?.source, 'assignment');
  assert.equal(e?.dueAt, dueAt);
});

// ---------- письмо «назначен курс» ----------

type MailRowT = { template: string; userId: string | null; dedupeKey: string | null; params: { dueAt: number | null; courseSlug: string } };
async function noticeMails(): Promise<MailRowT[]> {
  return db.sql<MailRowT>`
    SELECT template, user_id, dedupe_key, params FROM mail_outbox WHERE template = 'assignment_new' ORDER BY created_at, id`;
}

test('assignCourse: письмо assignment_new назначенным; пропущенные без письма; повтор — без дубля; новый срок — новое письмо', async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await course('noticeC');
  // у a2 личная покупка: назначение её не перезапишет, письма ему не будет
  await enroll({ userId: 'a2', courseId: 'noticeC', source: 'purchase' });
  const due1 = Date.now() + 3 * DAY;
  const res = await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'noticeC', userIds: ['a1', 'a2'], dueAt: due1 });
  assert.deepEqual(res.assigned, ['a1']);
  assert.deepEqual(res.skipped, ['a2']);
  let letters = await noticeMails();
  assert.equal(letters.length, 1);
  assert.equal(letters[0]?.userId, 'a1');
  assert.equal(letters[0]?.params.dueAt, due1);
  assert.equal(letters[0]?.params.courseSlug, 'noticeC');
  const enrollmentId = (await getEnrollment('a1', 'noticeC'))?.id;
  assert.equal(letters[0]?.dedupeKey, `assigned:${enrollmentId}:${due1}`);

  // повтор с тем же сроком письма не даёт
  await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'noticeC', userIds: ['a1'], dueAt: due1 });
  assert.equal((await noticeMails()).length, 1);

  // новый срок — новое письмо
  const due2 = due1 + DAY;
  await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'noticeC', userIds: ['a1'], dueAt: due2 });
  letters = await noticeMails();
  assert.equal(letters.length, 2);
  assert.equal(letters[1]?.params.dueAt, due2);

  // без срока — ключ none
  await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'noticeC', userIds: ['a1'] });
  letters = await noticeMails();
  assert.equal(letters.length, 3);
  assert.equal(letters[2]?.dedupeKey, `assigned:${enrollmentId}:none`);
  assert.equal(letters[2]?.params.dueAt, null);
});

test('assignCourse: отклонённое назначение писем не оставляет (транзакция целиком)', async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await rejects(assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'noticeC', userIds: ['a1', 'b1'] }), 'not_member');
  assert.equal((await noticeMails()).length, 0);
});

test('assignCourse: при выключенном REMINDERS письмо не ставится, назначение выдаётся', async () => {
  await db.sql`DELETE FROM mail_outbox`;
  const saved = process.env.FEATURE_REMINDERS;
  process.env.FEATURE_REMINDERS = '0';
  try {
    const res = await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'noticeC', userIds: ['both'] });
    assert.deepEqual(res.assigned, ['both']);
  } finally {
    if (saved === undefined) delete process.env.FEATURE_REMINDERS;
    else process.env.FEATURE_REMINDERS = saved;
  }
  assert.equal((await noticeMails()).length, 0);
});

// ---------- срок ----------

test('parseDueDate: конец выбранного дня по Астане; пусто — без срока; прошлое и мусор — ошибки', () => {
  const now = Date.parse('2026-10-19T10:00:00+05:00');
  assert.equal(parseDueDate('', now), null);
  assert.equal(parseDueDate(undefined, now), null);
  assert.equal(parseDueDate('2026-10-25', now), Date.parse('2026-10-25T23:59:59+05:00'));
  // сегодняшний день допустим: срок — до конца дня
  assert.equal(parseDueDate('2026-10-19', now), Date.parse('2026-10-19T23:59:59+05:00'));
  assert.throws(() => parseDueDate('2026-10-18', now), (e: unknown) => e instanceof TeamError && e.code === 'due_past');
  for (const bad of ['25.10.2026', '2026-13-01', '2026-02-31', 'завтра', '2026-10-25T10:00']) {
    assert.throws(() => parseDueDate(bad, now), (e: unknown) => e instanceof TeamError && e.code === 'invalid_input', bad);
  }
});
