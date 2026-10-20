import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { canAccessCourse, DAY_MS, getEnrollment } from '../../src/lib/access';
import {
  AdminError,
  changeRole,
  getDashboardStats,
  getUserDetail,
  grantAccess,
  listRecentAudit,
  listUsers,
  revokeAccess,
} from '../../src/lib/admin';
import { seedId } from '../../src/lib/content/ids';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { requestPasswordReset } from '../../src/lib/auth/recovery';
import { getUserConsents, sendResetLink } from '../../src/lib/admin/userCard';

let db: TestDb;
const admin = { id: 'adm', role: 'admin' };
const learner = { id: 'u1', role: 'learner' };

async function rejects(p: Promise<unknown>, code: string): Promise<AdminError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof AdminError, `ожидалась AdminError, получено ${String(e)}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`ожидалась ошибка ${code}`);
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('adm', 'adm@x.kz', 'Дана Админ', 'admin', 10),
    ('adm2', 'adm2@x.kz', 'Второй Админ', 'admin', 11),
    ('u1', 'aigerim@x.kz', 'Айгерим Сейтказы', 'learner', 20),
    ('u2', 'marat@x.kz', 'Марат Нурланов', 'learner', 30),
    ('u3', '100%_user@x.kz', 'Процент', 'learner', 40)`;
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES ('o1', 'crp', 'ЦРП', 'owner', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES
    ('o1', 'u1', 'manager', 1), ('o1', 'u2', 'member', 1)`;
  await db.sql`INSERT INTO courses (id, slug, title, status, created_at, updated_at) VALUES
    ('c1', 'c1', ${db.json({ ru: 'Курс 1' })}, 'published', 1, 1),
    ('c2', 'c2', ${db.json({ ru: 'Курс 2', kz: 'Курс 2 kz' })}, 'draft', 1, 1)`;
  await db.sql`INSERT INTO course_offers (id, course_id, price_kzt, access_days, active, created_at)
    VALUES ('of1', 'c1', 50000, 30, true, 1)`;
  await db.sql`INSERT INTO orders (id, number, user_id, course_id, amount_kzt, status, buyer_type, buyer_name,
      buyer_email, buyer_phone, payment_method, created_at, updated_at)
    VALUES ('ord1', 'CRP-1', 'u2', 'c1', 50000, 'pending', 'person', 'М', 'm@x.kz', '+7', 'kaspi', 1, 1)`;
});
after(async () => {
  await db.close();
});

test('список пользователей: поиск по имени и email, роль, организации, постранично', async () => {
  const all = await listUsers(admin);
  assert.equal(all.total, 5);
  // новые сверху
  assert.deepEqual(all.rows.map((r) => r.id), ['u3', 'u2', 'u1', 'adm2', 'adm']);
  const u1 = all.rows.find((r) => r.id === 'u1');
  assert.deepEqual(u1?.organizations, [{ name: 'ЦРП', role: 'manager' }]);

  assert.deepEqual((await listUsers(admin, { q: 'марат' })).rows.map((r) => r.id), ['u2']);
  assert.deepEqual((await listUsers(admin, { q: 'AIGERIM@' })).rows.map((r) => r.id), ['u1']);
  assert.deepEqual((await listUsers(admin, { q: '100%_' })).rows.map((r) => r.id), ['u3']);
  assert.equal((await listUsers(admin, { q: '%' })).total, 1); // % — буквальный символ
  assert.deepEqual((await listUsers(admin, { role: 'admin' })).rows.map((r) => r.id), ['adm2', 'adm']);

  const p2 = await listUsers(admin, { pageSize: 2, page: 2 });
  assert.equal(p2.total, 5);
  assert.deepEqual(p2.rows.map((r) => r.id), ['u1', 'adm2']);
});

test('выдача доступа: source grant, grantedBy, срок в днях, аудит', async () => {
  const before = Date.now();
  const e = await grantAccess(admin, { userId: 'u2', courseId: 'c1', accessDays: '30' });
  assert.equal(e.source, 'grant');
  assert.equal(e.grantedBy, 'adm');
  assert.ok(e.expiresAt && e.expiresAt >= before + 30 * DAY_MS && e.expiresAt <= Date.now() + 30 * DAY_MS);
  assert.equal((await canAccessCourse('u2', 'c1')).ok, true);

  // бессрочно: пустой срок
  const forever = await grantAccess(admin, { userId: 'u1', courseId: 'c2', accessDays: '' });
  assert.equal(forever.expiresAt, null);

  const rows = await db.sql<{ actorId: string }>`
    SELECT actor_id FROM audit_log WHERE action = 'enrollment.grant' AND entity_id = ${e.id}`;
  assert.equal(rows[0]?.actorId, 'adm');
});

test('выдача доступа: валидация и несуществующие сущности', async () => {
  let e = await rejects(grantAccess(admin, { userId: 'u2', courseId: 'c1', accessDays: 'abc' }), 'VALIDATION');
  assert.equal(e.fields?.accessDays, 'notNumber');
  e = await rejects(grantAccess(admin, { userId: 'u2', courseId: 'c1', accessDays: '0' }), 'VALIDATION');
  assert.equal(e.fields?.accessDays, 'tooSmall');
  e = await rejects(grantAccess(admin, { userId: 'u2', courseId: 'c1', accessDays: '1.5' }), 'VALIDATION');
  assert.equal(e.fields?.accessDays, 'notInteger');
  await rejects(grantAccess(admin, { userId: '', courseId: 'c1' }), 'VALIDATION');
  e = await rejects(grantAccess(admin, { userId: 'нет-такого', courseId: 'c1' }), 'NOT_FOUND');
  assert.equal(e.fields?.userId, 'invalid');
  e = await rejects(grantAccess(admin, { userId: 'u2', courseId: 'нет-такого' }), 'NOT_FOUND');
  assert.equal(e.fields?.courseId, 'invalid');
});

test('отзыв доступа и повторная выдача', async () => {
  await revokeAccess(admin, 'u2', 'c1');
  const r = await canAccessCourse('u2', 'c1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'revoked');
  const revokes = await db.sql<{ actorId: string }>`
    SELECT actor_id FROM audit_log WHERE action = 'enrollment.revoke'`;
  assert.deepEqual(revokes.map((x) => x.actorId), ['adm']);

  await revokeAccess(admin, 'u2', 'c1'); // повторный отзыв — без ошибок и без второй записи
  assert.equal((await db.sql`SELECT 1 FROM audit_log WHERE action = 'enrollment.revoke'`).length, 1);

  await grantAccess(admin, { userId: 'u2', courseId: 'c1' }); // возобновление
  assert.equal((await canAccessCourse('u2', 'c1')).ok, true);
  assert.equal((await getEnrollment('u2', 'c1'))?.revokedAt, null);

  await rejects(revokeAccess(admin, 'u3', 'c1'), 'NOT_FOUND');
});

test('карточка пользователя: зачисления с состоянием, источником и кто выдал', async () => {
  // просроченное зачисление
  await db.sql`INSERT INTO enrollments (id, user_id, course_id, source, expires_at, created_at, updated_at)
    VALUES ('old', 'u3', 'c1', 'purchase', 5, 1, 1)`;
  const d3 = await getUserDetail(admin, 'u3');
  assert.equal(d3?.enrollments[0]?.state, 'expired');

  const d1 = await getUserDetail(admin, 'u1');
  assert.equal(d1?.user.email, 'aigerim@x.kz');
  assert.deepEqual(d1?.memberships, [{ orgId: 'o1', orgName: 'ЦРП', role: 'manager', position: null }]);
  assert.equal(d1?.enrollments[0]?.courseTitle.ru, 'Курс 2');
  assert.equal(d1?.enrollments[0]?.grantedByName, 'Дана Админ');
  assert.equal(d1?.enrollments[0]?.state, 'active');

  await revokeAccess(admin, 'u1', 'c2');
  assert.equal((await getUserDetail(admin, 'u1'))?.enrollments[0]?.state, 'revoked');
  assert.equal(await getUserDetail(admin, 'нет-такого'), null);
});

test('смена роли: себя менять нельзя, остальных — можно, пишется аудит', async () => {
  await rejects(changeRole(admin, { userId: 'adm', role: 'learner' }), 'CANNOT_CHANGE_SELF');
  assert.equal((await getUserDetail(admin, 'adm'))?.user.role, 'admin');

  await changeRole(admin, { userId: 'u2', role: 'author' });
  assert.equal((await getUserDetail(admin, 'u2'))?.user.role, 'author');
  const [log] = await db.sql<{ meta: { from: string; to: string } }>`
    SELECT meta FROM audit_log WHERE action = 'user.role_change'`;
  assert.deepEqual({ from: log?.meta.from, to: log?.meta.to }, { from: 'learner', to: 'author' });

  const e = await rejects(changeRole(admin, { userId: 'u2', role: 'superuser' }), 'VALIDATION');
  assert.equal(e.fields?.role, 'invalid');
  await rejects(changeRole(admin, { userId: 'нет-такого', role: 'author' }), 'NOT_FOUND');

  // повышение до админа → этот админ теперь может понизить первого
  await changeRole(admin, { userId: 'adm2', role: 'admin' }); // без изменений — no-op
  await changeRole({ id: 'adm2', role: 'admin' }, { userId: 'adm', role: 'learner' });
  assert.equal((await getUserDetail({ id: 'adm2', role: 'admin' }, 'adm'))?.user.role, 'learner');
  // понижённый сразу теряет доступ к админским функциям (роль берётся из БД)
  await rejects(listUsers(admin), 'FORBIDDEN');
});

test('сводка: счётчики и лента аудита без перестановок', async () => {
  const actor = { id: 'adm2', role: 'admin' };
  const s = await getDashboardStats(actor);
  assert.equal(s.users, 5);
  assert.equal(s.publishedCourses, 1);
  assert.equal(s.pendingOrders, 1);
  assert.equal(s.certificates, 0);
  assert.equal(s.activeEnrollments, 1); // u2 → c1; остальные отозваны или истекли

  await db.sql`INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
    VALUES ('mv', 'adm2', 'lesson.move', 'lesson', 'l', ${db.json({})}, 9999999999999)`;
  const feed = await listRecentAudit(actor, 50);
  assert.ok(feed.length > 0);
  assert.ok(feed.every((f) => !f.action.endsWith('.move')));
  const grant = feed.find((f) => f.action === 'enrollment.grant' && f.user === 'Марат Нурланов');
  assert.equal(grant?.course, 'Курс 1');
  assert.equal(grant?.actorName, 'Дана Админ');
  const role = feed.find((f) => f.action === 'user.role_change' && f.to === 'author');
  assert.equal(role?.user, 'Марат Нурланов');
});

test('не администратор: все функции отклоняются', async () => {
  await rejects(listUsers(learner), 'FORBIDDEN');
  await rejects(getUserDetail(learner, 'u2'), 'FORBIDDEN');
  await rejects(grantAccess(learner, { userId: 'u1', courseId: 'c1' }), 'FORBIDDEN');
  await rejects(revokeAccess(learner, 'u2', 'c1'), 'FORBIDDEN');
  await rejects(changeRole(learner, { userId: 'u1', role: 'admin' }), 'FORBIDDEN');
  await rejects(getDashboardStats(learner), 'FORBIDDEN');
  await rejects(listRecentAudit(learner), 'FORBIDDEN');
  // самовыдача доступа и самоповышение невозможны
  assert.equal((await getEnrollment('u1', 'c1')), null);
  assert.equal((await db.sql<{ role: string }>`SELECT role FROM users WHERE id = 'u1'`)[0]?.role, 'learner');
});

// ---------- ссылка для смены пароля и блок «Согласия» (4A) ----------
// первый админ к этому месту понижен тестом смены роли, действует второй
const admin2 = { id: 'adm2', role: 'admin' };

type AuditRow = { actorId: string | null; entityId: string; action: string; meta: Record<string, unknown> };
async function resetAudit(action: string, entityId: string): Promise<AuditRow[]> {
  return db.sql<AuditRow>`SELECT actor_id, entity_id, action, meta FROM audit_log WHERE action = ${action} AND entity_id = ${entityId}`;
}
async function resetMails(userId: string): Promise<number> {
  const [r] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox WHERE user_id = ${userId} AND template = 'password_reset'`;
  return r?.n ?? 0;
}
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('sendResetLink: письмо в очереди, журнал user.password_reset_link от имени админа, без email в журнале', async () => {
  const res = await sendResetLink(admin2, 'u3');
  assert.deepEqual(res, { sent: true });
  assert.equal(await resetMails('u3'), 1);
  const link = await resetAudit('user.password_reset_link', 'u3');
  assert.equal(link.length, 1);
  assert.equal(link[0]?.actorId, 'adm2');
  assert.deepEqual(link[0]?.meta, {});
  const req = await resetAudit('user.password_reset_request', 'u3');
  assert.equal(req.length, 1);
  assert.equal(req[0]?.actorId, 'adm2');
  assert.ok(!JSON.stringify([link, req]).includes('@'), 'адрес в журнале не нужен');
});

test('sendResetLink: сид-аккаунт в демо — отказ demo_seed, записи журнала и письма нет', async () => {
  const email = 'seedlink@crp.demo';
  const id = seedId('user', email);
  await db.sql`INSERT INTO users (id, email, name, locale, created_at) VALUES (${id}, ${email}, 'Сид', 'ru', 50)`;
  await withEnv({ DEMO_MODE: '1', DATABASE_URL: undefined }, async () => {
    assert.deepEqual(await sendResetLink(admin2, id), { sent: false, reason: 'demo_seed' });
  });
  assert.equal(await resetMails(id), 0);
  assert.equal((await resetAudit('user.password_reset_link', id)).length, 0);
  assert.equal((await resetAudit('user.password_reset_request', id)).length, 0);
});

test('sendResetLink: лимит писем на получателя — отказ rate_limited, шестой записи журнала нет', async () => {
  for (let i = 0; i < 5; i++) assert.deepEqual(await sendResetLink(admin2, 'u2'), { sent: true });
  assert.deepEqual(await sendResetLink(admin2, 'u2'), { sent: false, reason: 'rate_limited' });
  assert.equal(await resetMails('u2'), 5);
  assert.equal((await resetAudit('user.password_reset_link', 'u2')).length, 5);
});

test('sendResetLink: флаг выключен — FEATURE_DISABLED без записей; нет пользователя — NOT_FOUND; не админ — FORBIDDEN', async () => {
  await withEnv({ FEATURE_PASSWORD_RESET: '0' }, async () => {
    await rejects(sendResetLink(admin2, 'u1'), 'FEATURE_DISABLED');
  });
  assert.equal(await resetMails('u1'), 0);
  assert.equal((await resetAudit('user.password_reset_link', 'u1')).length, 0);
  await rejects(sendResetLink(admin2, 'нет-такого'), 'NOT_FOUND');
  await rejects(sendResetLink(learner, 'u3'), 'FORBIDDEN');
  await rejects(sendResetLink(null as never, 'u3'), 'FORBIDDEN');
});

test('getUserConsents: только администратору; легаси-строки (без хэша текста) отличимы; LEGAL выключен — пусто', async () => {
  const sha = 'a'.repeat(64);
  await db.sql`INSERT INTO legal_texts (sha256, kind, version, locale, title, body, draft, created_at)
    VALUES (${sha}, 'pd_consent', '2026-10-20', 'ru', 'Согласие', 'Текст', true, 100)`;
  await db.sql`INSERT INTO consents (id, user_id, order_id, kind, version, locale, context, text_sha256, created_at) VALUES
    ('cs1', 'u2', NULL, 'pd_processing', '2026-10-19', NULL, NULL, NULL, 100),
    ('cs2', 'u2', 'ord1', 'offer', '2026-10-20', 'ru', 'checkout', ${sha}, 200)`;

  const rows = await getUserConsents(admin2, 'u2');
  assert.deepEqual(
    rows.map((r) => [r.kind, r.version, r.textSha256 === null, r.orderNumber]),
    [
      ['offer', '2026-10-20', false, 'CRP-1'],
      ['pd_processing', '2026-10-19', true, null],
    ],
  );
  assert.deepEqual(await getUserConsents(admin2, 'u1'), []);

  await rejects(getUserConsents(learner, 'u2'), 'FORBIDDEN');
  await rejects(getUserConsents({ id: 'adm2', role: 'learner' }, 'u2'), 'FORBIDDEN');
  // в переданном объекте роль admin, но в БД у пользователя её нет
  await rejects(getUserConsents({ id: 'u1', role: 'admin' }, 'u2'), 'FORBIDDEN');

  await withEnv({ FEATURE_LEGAL: '0' }, async () => {
    assert.deepEqual(await getUserConsents(admin2, 'u2'), []);
  });
});

test('requestPasswordReset: результат для вызывающего — not_found, unavailable (флаг), sent', async () => {
  assert.deepEqual(await requestPasswordReset({ email: 'nobody@x.kz', locale: 'ru' }), { sent: false, reason: 'not_found' });
  await withEnv({ FEATURE_PASSWORD_RESET: '0' }, async () => {
    assert.deepEqual(await requestPasswordReset({ email: 'marat@x.kz', locale: 'ru' }), { sent: false, reason: 'unavailable' });
  });
  assert.equal(await resetMails('u2'), 5, 'новых писем при отказах нет');
  assert.deepEqual(await requestPasswordReset({ email: 'adm@x.kz', locale: 'ru' }), { sent: true });
});
