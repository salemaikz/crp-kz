// Страница «Письма»: доступ только администратору, фильтры, постраничность, ссылка видна только в демо.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { AdminError } from '../../src/lib/admin';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { getMailView, listMail, mailPagesActive, MAIL_PAGE_SIZE, visibleDemoLink } from '../../src/lib/mail';
import type { MailRow } from '../../src/lib/mail/outbox';
import type { MailStatus, MailTemplate } from '../../src/lib/mail/types';

let db: TestDb;
const admin = { id: 'adm', role: 'admin' };
const learner = { id: 'u1', role: 'learner' };
const TOKEN = 'Q'.repeat(43);
const FEATURES = ['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS'] as const;
const saved = Object.fromEntries(FEATURES.map((f) => [f, process.env[`FEATURE_${f}`]]));
const savedEnv = { demo: process.env.DEMO_MODE, url: process.env.DATABASE_URL, site: process.env.NEXT_PUBLIC_SITE_URL };

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e) => e instanceof AdminError && e.code === code, code);
}

function restoreEnv() {
  for (const f of FEATURES) {
    if (saved[f] === undefined) delete process.env[`FEATURE_${f}`];
    else process.env[`FEATURE_${f}`] = saved[f];
  }
  for (const [k, v] of [['DEMO_MODE', savedEnv.demo], ['DATABASE_URL', savedEnv.url], ['NEXT_PUBLIC_SITE_URL', savedEnv.site]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('adm', 'adm@x.kz', 'Админ', 'admin', 1), ('u1', 'u1@x.kz', 'Слушатель', 'learner', 1)`;
});
afterEach(restoreEnv);
after(async () => {
  restoreEnv();
  await db.close();
});

async function put(id: string, template: MailTemplate, status: MailStatus, createdAt: number, to = 'to@x.kz') {
  const secret = template === 'password_reset' ? TOKEN : null;
  await db.sql`
    INSERT INTO mail_outbox (id, category, template, locale, user_id, to_email, params, secret, secret_expires_at, status,
                             attempts, last_error, created_at, updated_at)
    VALUES (${id}, ${template === 'password_reset' ? 'auth' : 'notice'}, ${template}, 'ru', 'u1', ${to},
            ${db.json(template === 'password_reset' ? { name: 'Имя' } : { name: 'Имя', courseSlug: 'c', courseTitle: { ru: 'Курс' }, dueAt: null })},
            ${secret}, ${secret ? createdAt + 3_600_000_000 : null}, ${status}, 2, ${status === 'failed' ? 'Ошибка транспорта' : null},
            ${createdAt}, ${createdAt})`;
}

test('не администратор и гость: FORBIDDEN в списке и в просмотре', async () => {
  await rejects(listMail(learner, { page: 1 }), 'FORBIDDEN');
  await rejects(getMailView(learner, 'x'), 'FORBIDDEN');
  await rejects(listMail(null as never, { page: 1 }), 'FORBIDDEN');
  // роль в переданном объекте не заменяет проверку по БД
  await rejects(listMail({ id: 'u1', role: 'admin' }, { page: 1 }), 'FORBIDDEN');
});

test('список: новые сверху, фильтры по статусу и шаблону, лишние значения игнорируются', async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await put('m1', 'password_reset', 'held', 100);
  await put('m2', 'assignment_new', 'sent', 200);
  await put('m3', 'assignment_new', 'failed', 300);
  const all = await listMail(admin, { page: 1 });
  assert.equal(all.total, 3);
  assert.deepEqual(all.rows.map((r) => r.id), ['m3', 'm2', 'm1']);
  assert.ok(!('secret' in (all.rows[0] ?? {})), 'в списке нет секретов');

  assert.deepEqual((await listMail(admin, { status: 'sent' })).rows.map((r) => r.id), ['m2']);
  assert.deepEqual((await listMail(admin, { template: 'assignment_new' })).rows.map((r) => r.id), ['m3', 'm2']);
  assert.deepEqual((await listMail(admin, { status: 'failed', template: 'assignment_new' })).rows.map((r) => r.id), ['m3']);
  assert.equal((await listMail(admin, { status: 'cancelled' })).total, 0);
  // значение вне списка не доходит до SQL и не сужает выборку
  assert.equal((await listMail(admin, { status: "held' OR 1=1 --" as MailStatus })).total, 3);
});

test('постраничность: 50 на страницу', async () => {
  await db.sql`DELETE FROM mail_outbox`;
  for (let i = 0; i < MAIL_PAGE_SIZE + 5; i++) await put(`p${String(i).padStart(3, '0')}`, 'assignment_new', 'held', 1000 + i);
  const p1 = await listMail(admin, { page: 1 });
  const p2 = await listMail(admin, { page: 2 });
  assert.equal(p1.total, MAIL_PAGE_SIZE + 5);
  assert.equal(p1.rows.length, MAIL_PAGE_SIZE);
  assert.equal(p2.rows.length, 5);
  assert.equal(p1.rows[0]?.id, `p${String(MAIL_PAGE_SIZE + 4).padStart(3, '0')}`);
  assert.deepEqual((await listMail(admin, { page: -3 })).rows.length, MAIL_PAGE_SIZE);
});

test('просмотр: тема и текст без ссылки с токеном; в демо ссылка отдельным полем', async () => {
  await db.sql`DELETE FROM mail_outbox`;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://learn.example.kz';
  await put('r1', 'password_reset', 'held', Date.now());
  const v = await getMailView(admin, 'r1');
  assert.ok(v);
  assert.equal(v.subject, 'Восстановление пароля');
  assert.ok(!v.text.includes(TOKEN), 'токен не попадает в текст');
  assert.ok(!v.text.includes('/password/reset'));
  assert.equal(v.demoLink, `https://learn.example.kz/ru/password/reset#token=${TOKEN}`);
  assert.equal(await getMailView(admin, 'нет-такого'), null);
});

test('просмотр: у письма без секрета, истёкшего и отменённого ссылки нет', async () => {
  await db.sql`DELETE FROM mail_outbox`;
  await put('n1', 'assignment_new', 'held', Date.now());
  assert.equal((await getMailView(admin, 'n1'))?.demoLink, null);

  await put('e1', 'password_reset', 'held', Date.now() - 4_000_000_000);
  await db.sql`UPDATE mail_outbox SET secret_expires_at = ${Date.now() - 1000} WHERE id = 'e1'`;
  assert.equal((await getMailView(admin, 'e1'))?.demoLink, null);

  await put('c1', 'password_reset', 'cancelled', Date.now());
  assert.equal((await getMailView(admin, 'c1'))?.demoLink, null);

  await put('f1', 'assignment_new', 'failed', Date.now());
  assert.equal((await getMailView(admin, 'f1'))?.lastError, 'Ошибка транспорта');
});

test('visibleDemoLink: вне демо ссылка скрыта всегда', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://learn.example.kz';
  const row: MailRow = {
    id: 'x',
    template: 'password_reset',
    locale: 'ru',
    toEmail: 'a@x.kz',
    params: { name: 'A' },
    secret: TOKEN,
    secretExpiresAt: 2_000,
    status: 'held',
    createdAt: 1,
  };
  assert.ok(visibleDemoLink(row, true, 1_000)?.includes(TOKEN));
  assert.equal(visibleDemoLink(row, false, 1_000), null);
  assert.equal(visibleDemoLink(row, true, 2_000), null, 'срок вышел');
});

test('флаги: раздел виден при любом активном почтовом флаге, без них — FEATURE_DISABLED', async () => {
  assert.equal(mailPagesActive(), true, 'в демо все включены');
  process.env.FEATURE_PASSWORD_RESET = '0';
  process.env.FEATURE_EMAIL_VERIFY = '0';
  process.env.FEATURE_REMINDERS = '1';
  assert.equal(mailPagesActive(), true);
  assert.ok((await listMail(admin, { page: 1 })).total >= 0);

  process.env.FEATURE_REMINDERS = '0';
  assert.equal(mailPagesActive(), false);
  await rejects(listMail(admin, { page: 1 }), 'FEATURE_DISABLED');
  await rejects(getMailView(admin, 'r1'), 'FEATURE_DISABLED');
});

test('вне демо разделов нет, пока транспорт только outbox: функции не активны', async () => {
  process.env.DEMO_MODE = '';
  process.env.DATABASE_URL = 'postgres://app@db.example/crp';
  for (const f of FEATURES) process.env[`FEATURE_${f}`] = '1';
  assert.equal(mailPagesActive(), false);
  await rejects(listMail(admin, { page: 1 }), 'FEATURE_DISABLED');
});

test('выключенный раздел не создаёт писем', async () => {
  for (const f of FEATURES) process.env[`FEATURE_${f}`] = '0';
  const before = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
  await rejects(listMail(admin, { page: 1 }), 'FEATURE_DISABLED');
  const after = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
  assert.equal(after[0]?.n, before[0]?.n);
});
