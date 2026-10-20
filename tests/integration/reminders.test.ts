// Напоминания: кто получает письма, идемпотентность, изоляция организаций, флаг, журнал.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { setDb } from '../../src/lib/db';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { AdminError } from '../../src/lib/admin/errors';
import { planReminders } from '../../src/lib/reminders';
import { runRemindersAs } from '../../src/lib/reminders/admin';
import { assignCourse } from '../../src/lib/team/assign';

let db: TestDb;
const DAY = 86_400_000;
// полдень по Астане, вторник; сроки считаются по календарным дням Астаны
const NOW = Date.parse('2026-10-20T12:00:00+05:00');
const at = (days: number) => NOW + days * DAY;

type Letter = { template: string; userId: string | null; toEmail: string; params: Record<string, unknown>; dedupeKey: string | null };

async function letters(template?: string): Promise<Letter[]> {
  return db.sql<Letter>`
    SELECT template, user_id, to_email, params, dedupe_key FROM mail_outbox
    WHERE (${template ?? null}::text IS NULL OR template = ${template ?? null}) ORDER BY dedupe_key, id`;
}
const forUser = (ls: Letter[], id: string) => ls.filter((l) => l.userId === id);

async function user(id: string, orgId: string, role: 'manager' | 'member' = 'member', locale: 'ru' | 'kz' = 'ru') {
  await db.sql`INSERT INTO users (id, email, name, locale, created_at) VALUES (${id}, ${id + '@x.kz'}, ${'Имя ' + id}, ${locale}, 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES (${orgId}, ${id}, ${role}, 1)`;
}

let seq = 0;
async function enrollment(userId: string, orgId: string, over: { dueAt?: number | null; source?: string; revoked?: boolean; expiresAt?: number | null; courseId?: string } = {}) {
  const dueAt = over.dueAt === undefined ? null : over.dueAt;
  await db.sql`
    INSERT INTO enrollments (id, user_id, course_id, source, org_id, due_at, expires_at, revoked_at, created_at, updated_at)
    VALUES (${'e' + ++seq}, ${userId}, ${over.courseId ?? 'c1'}, ${over.source ?? 'assignment'}, ${orgId}, ${dueAt},
            ${over.expiresAt ?? null}, ${over.revoked ? 5 : null}, 1, 1)`;
}

const savedFlag = process.env.FEATURE_REMINDERS;
before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES
    ('orgA', 'crp', 'ЦРП', 'owner', 1), ('orgB', 'client', 'Клиент', 'client', 1)`;
  await db.sql`INSERT INTO courses (id, slug, title, visibility, owner_org_id, status, created_at, updated_at) VALUES
    ('c1', 'c1', ${db.json({ ru: 'Онбординг', kz: 'Онбординг kz' })}, 'public', NULL, 'published', 1, 1),
    ('c2', 'c2', ${db.json({ ru: 'Регламент' })}, 'public', NULL, 'published', 1, 1)`;
  await db.sql`INSERT INTO course_modules (id, course_id, position, title, created_at) VALUES ('mx', 'c2', 0, ${db.json({ ru: 'М' })}, 1)`;
  await db.sql`INSERT INTO lessons (id, course_id, module_id, position, slug, title, status, created_at, updated_at)
    VALUES ('lx', 'c2', 'mx', 0, 'lx', ${db.json({ ru: 'У' })}, 'published', 1, 1)`;
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await db.sql`DELETE FROM audit_log`;
  await db.sql`DELETE FROM lesson_progress`;
  await db.sql`DELETE FROM enrollments`;
  await db.sql`DELETE FROM organization_members`;
  await db.sql`DELETE FROM users`;
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env.FEATURE_REMINDERS;
  else process.env.FEATURE_REMINDERS = savedFlag;
});

/** Сид-подобная организация: два просроченных, один скоро, остальные без напоминаний. */
async function seedLike() {
  await user('mgrA', 'orgA', 'manager');
  await user('mgrA2', 'orgA', 'manager', 'kz');
  await user('ann', 'orgA'); // -3 дня
  await user('bek', 'orgA'); // -7 дней
  await user('cem', 'orgA'); // +2 дня
  await user('dan', 'orgA'); // +5 дней
  await enrollment('ann', 'orgA', { dueAt: at(-3) });
  await enrollment('bek', 'orgA', { dueAt: at(-7) });
  await enrollment('cem', 'orgA', { dueAt: at(2) });
  await enrollment('dan', 'orgA', { dueAt: at(5) });
}

test('как в сиде: 2 «срок прошёл», 1 «скоро срок», сводка каждому менеджеру; повтор — ничего нового', async () => {
  await seedLike();
  const res = await planReminders({ nowMs: NOW, actorId: 'mgrA' });
  assert.deepEqual(res, { disabled: false, dueSoon: 1, overdue: 2, digests: 2 });

  const all = await letters();
  assert.equal(all.filter((l) => l.template === 'overdue').length, 2);
  assert.equal(all.filter((l) => l.template === 'due_soon').length, 1);
  assert.equal(all.filter((l) => l.template === 'manager_digest').length, 2);
  assert.deepEqual(forUser(all, 'dan'), [], '+5 дней — рано');
  assert.equal(forUser(all, 'cem')[0]?.template, 'due_soon');
  assert.equal(forUser(all, 'cem')[0]?.params.progress, 0);
  assert.deepEqual(forUser(all, 'ann').map((l) => l.template), ['overdue']);
  // язык письма — язык получателя
  const kz = (await db.sql<{ locale: string }>`SELECT locale FROM mail_outbox WHERE user_id = 'mgrA2'`)[0];
  assert.equal(kz?.locale, 'kz');

  const again = await planReminders({ nowMs: NOW + 60_000, actorId: 'mgrA' });
  assert.deepEqual(again, { disabled: false, dueSoon: 0, overdue: 0, digests: 0 });
  assert.equal((await letters()).length, all.length);
});

test('продление срока даёт новое письмо, сводка в ту же неделю не повторяется', async () => {
  await seedLike();
  await planReminders({ nowMs: NOW, actorId: null });
  await db.sql`UPDATE enrollments SET due_at = ${at(-2)} WHERE user_id = 'ann'`;
  const res = await planReminders({ nowMs: NOW + 1000, actorId: null });
  assert.deepEqual(res, { disabled: false, dueSoon: 0, overdue: 1, digests: 0 });
});

test('сводка: раз в ISO-неделю; через неделю — новая', async () => {
  await seedLike();
  await planReminders({ nowMs: NOW, actorId: null });
  const sameWeek = await planReminders({ nowMs: at(3), actorId: null });
  assert.equal(sameWeek.disabled === false && sameWeek.digests, 0);
  const nextWeek = await planReminders({ nowMs: at(7), actorId: null });
  assert.equal(nextWeek.disabled === false && nextWeek.digests, 2);
  const keys = (await letters('manager_digest')).map((l) => l.dedupeKey);
  assert.equal(new Set(keys).size, 4);
  assert.ok(keys.some((k) => k?.endsWith(':2026-W43')));
  assert.ok(keys.some((k) => k?.endsWith(':2026-W44')));
});

test('закрытый доступ, вышедший из организации, завершивший, не назначение, старая просрочка — без напоминаний', async () => {
  await user('mgrA', 'orgA', 'manager');
  await user('rev', 'orgA');
  await user('exp', 'orgA');
  await user('left', 'orgA');
  await user('buyer', 'orgA');
  await user('old', 'orgA');
  await user('done', 'orgA');
  await enrollment('rev', 'orgA', { dueAt: at(-1), revoked: true });
  await enrollment('exp', 'orgA', { dueAt: at(-1), expiresAt: at(-1) });
  await enrollment('left', 'orgA', { dueAt: at(-1) });
  await db.sql`DELETE FROM organization_members WHERE user_id = 'left'`;
  await enrollment('buyer', 'orgA', { dueAt: at(-1), source: 'purchase' });
  await enrollment('old', 'orgA', { dueAt: at(-40) });
  // завершён: единственный опубликованный урок пройден
  await db.sql`INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at) VALUES ('done', 'lx', 'c2', 5)`;
  await enrollment('done', 'orgA', { dueAt: at(-1), courseId: 'c2' });

  const res = await planReminders({ nowMs: NOW, actorId: null });
  // письма сотрудникам: только «old» не получает (40 дней), остальные закрыты
  assert.equal(res.disabled === false && res.dueSoon + res.overdue, 0);
  const ls = await letters();
  for (const id of ['rev', 'exp', 'left', 'buyer', 'old', 'done']) assert.deepEqual(forUser(ls, id), [], id);
});

test('изоляция организаций: менеджер B не получает сводку A и наоборот, в сводке только свои сотрудники', async () => {
  await user('mgrA', 'orgA', 'manager');
  await user('ann', 'orgA');
  await enrollment('ann', 'orgA', { dueAt: at(-3) });
  await user('mgrB', 'orgB', 'manager');
  await user('bob', 'orgB');
  await enrollment('bob', 'orgB', { dueAt: at(-5) });
  // руководитель в B и обычный сотрудник в A: сводку получает только как руководитель B
  await user('both', 'orgB', 'manager');
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES ('orgA', 'both', 'member', 1)`;

  const res = await planReminders({ nowMs: NOW, actorId: null });
  assert.equal(res.disabled === false && res.digests, 3);
  const digests = await letters('manager_digest');
  const names = (l: Letter | undefined) => JSON.stringify(l?.params);

  const toA = forUser(digests, 'mgrA');
  assert.equal(toA.length, 1);
  assert.equal(toA[0]?.params.orgSlug, 'crp');
  assert.ok(names(toA[0]).includes('Имя ann'));
  assert.ok(!names(toA[0]).includes('Имя bob'), 'сотрудник B в сводке A');

  for (const id of ['mgrB', 'both']) {
    const d = forUser(digests, id);
    assert.equal(d.length, 1, id);
    assert.equal(d[0]?.params.orgSlug, 'client');
    assert.ok(names(d[0]).includes('Имя bob'));
    assert.ok(!names(d[0]).includes('Имя ann'), 'сотрудник A в сводке B');
  }
  // обычный сотрудник сводку не получает
  assert.deepEqual(forUser(digests, 'ann'), []);
  assert.equal(toA[0]?.params.overdueTotal, 1);
});

test('в сводке не больше 20 строк, итог — полным числом', async () => {
  await user('mgrA', 'orgA', 'manager');
  for (let i = 0; i < 23; i++) {
    await user(`p${String(i).padStart(2, '0')}`, 'orgA');
    await enrollment(`p${String(i).padStart(2, '0')}`, 'orgA', { dueAt: at(-1) });
  }
  await planReminders({ nowMs: NOW, actorId: null });
  const [d] = await letters('manager_digest');
  assert.equal((d?.params.overdue as unknown[]).length, 20);
  assert.equal(d?.params.overdueTotal, 23);
  assert.equal(d?.params.soonTotal, 0);
});

test('свежее «назначен курс» гасит «скоро срок» на 48 часов; через 48 часов напоминание уходит', async () => {
  await user('mgrA', 'orgA', 'manager');
  await user('ann', 'orgA');
  await db.sql`INSERT INTO courses (id, slug, title, visibility, owner_org_id, status, created_at, updated_at)
    VALUES ('cA', 'cA', ${db.json({ ru: 'Внутренний' })}, 'internal', 'orgA', 'published', 1, 1)`;
  const realNow = Date.now();
  const dueAt = realNow + 2 * DAY;
  await assignCourse({ actorId: 'mgrA', orgId: 'orgA', courseId: 'cA', userIds: ['ann'], dueAt, nowMs: realNow });
  assert.equal((await letters('assignment_new')).length, 1);

  const first = await planReminders({ nowMs: realNow + 3600_000, actorId: null });
  assert.equal(first.disabled === false && first.dueSoon, 0, 'срок уже указан в письме о назначении');
  assert.deepEqual(forUser(await letters(), 'ann').map((l) => l.template), ['assignment_new']);

  const later = await planReminders({ nowMs: realNow + 49 * 3600_000, actorId: null });
  assert.equal(later.disabled === false && later.dueSoon, 1);
});

test('флаг REMINDERS выключен: disabled, писем и журнала нет', async () => {
  await seedLike();
  process.env.FEATURE_REMINDERS = '0';
  assert.deepEqual(await planReminders({ nowMs: NOW, actorId: 'mgrA' }), { disabled: true });
  assert.equal((await letters()).length, 0);
  assert.equal((await db.sql`SELECT 1 FROM audit_log WHERE action = 'reminders.run'`).length, 0);
});

test('журнал: reminders.run с сущностью reminders, счётчиками и автором; без ПДн', async () => {
  await seedLike();
  await planReminders({ nowMs: NOW, actorId: 'mgrA' });
  const rows = await db.sql<{ actorId: string | null; entity: string; entityId: string; meta: Record<string, unknown> }>`
    SELECT actor_id, entity, entity_id, meta FROM audit_log WHERE action = 'reminders.run'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.actorId, 'mgrA');
  assert.equal(rows[0]?.entity, 'reminders');
  assert.equal(rows[0]?.entityId, 'reminders');
  assert.deepEqual(rows[0]?.meta, { dueSoon: 1, overdue: 2, digests: 2 });

  // крон: автор NULL; пустой повтор записи не добавляет
  await db.sql`DELETE FROM mail_outbox`;
  await planReminders({ nowMs: NOW, actorId: null });
  await planReminders({ nowMs: NOW, actorId: null });
  const cron = await db.sql<{ actorId: string | null }>`SELECT actor_id FROM audit_log WHERE action = 'reminders.run' AND actor_id IS NULL`;
  assert.equal(cron.length, 1, 'пустой повтор записи не добавляет');

  // ручной запуск админа пишется всегда, даже когда нового нет
  await planReminders({ nowMs: NOW, actorId: 'mgrA' });
  const manual = await db.sql<{ meta: Record<string, unknown> }>`
    SELECT meta FROM audit_log WHERE action = 'reminders.run' AND actor_id = 'mgrA'`;
  assert.equal(manual.length, 2, 'повторное нажатие кнопки тоже в журнале');
  assert.ok(manual.some((m) => m.meta.dueSoon === 0 && m.meta.overdue === 0 && m.meta.digests === 0));
});

test('на настоящем сиде: ровно 2 «срок прошёл», 1 «скоро срок» и сводка manager@crp.demo', async () => {
  const fresh = await createTestDb();
  try {
    const { seed } = await import('../../src/lib/db/seed');
    await seed(fresh, { nowMs: NOW });
    const res = await planReminders({ nowMs: NOW, actorId: null });
    assert.deepEqual(res, { disabled: false, dueSoon: 1, overdue: 2, digests: 1 });
    const digests = await fresh.sql<{ toEmail: string }>`SELECT to_email FROM mail_outbox WHERE template = 'manager_digest'`;
    assert.deepEqual(digests.map((d) => d.toEmail), ['manager@crp.demo']);
  } finally {
    setDb(db); // обратно к БД остальных тестов файла
    await fresh.close();
  }
});

test('сид не создаёт строк mail_outbox: время в ключах и params не должно уезжать при сдвиге снимка', async () => {
  const fresh = await createTestDb({ register: false });
  try {
    const { seed } = await import('../../src/lib/db/seed');
    await seed(fresh);
    const [n] = await fresh.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
    assert.equal(n?.n, 0);
    const [u] = await fresh.sql<{ n: number }>`SELECT count(*) AS n FROM users`;
    assert.ok((u?.n ?? 0) > 0, 'сид действительно отработал');
  } finally {
    await fresh.close();
  }
});

test('runRemindersAs: только администратор; без флага — FEATURE_DISABLED и без записей; результат — числа для кнопки', async () => {
  await seedLike();
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES ('adm', 'adm@x.kz', 'Админ', 'admin', 1)`;
  const forbidden = (code: string) => (e: unknown) => e instanceof AdminError && e.code === code;

  await assert.rejects(runRemindersAs({ id: 'ann', role: 'learner' }), forbidden('FORBIDDEN'));
  await assert.rejects(runRemindersAs({ id: 'ann', role: 'admin' }), forbidden('FORBIDDEN'), 'роль проверяется и по БД');
  assert.equal((await letters()).length, 0);

  process.env.FEATURE_REMINDERS = '0';
  await assert.rejects(runRemindersAs({ id: 'adm', role: 'admin' }), forbidden('FEATURE_DISABLED'));
  assert.equal((await letters()).length, 0);
  assert.equal((await db.sql`SELECT 1 FROM audit_log WHERE action = 'reminders.run'`).length, 0);
  delete process.env.FEATURE_REMINDERS;

  const res = await runRemindersAs({ id: 'adm', role: 'admin' });
  assert.equal(res.digests, 2);
  assert.ok(res.learners >= 0);
  const [a] = await db.sql<{ actorId: string }>`SELECT actor_id FROM audit_log WHERE action = 'reminders.run'`;
  assert.equal(a?.actorId, 'adm');
  assert.deepEqual(await runRemindersAs({ id: 'adm', role: 'admin' }), { learners: 0, digests: 0 });
  const runs = await db.sql`SELECT 1 FROM audit_log WHERE action = 'reminders.run' AND actor_id = 'adm'`;
  assert.equal(runs.length, 2, 'нажатие без новых писем тоже попадает в журнал');
});
