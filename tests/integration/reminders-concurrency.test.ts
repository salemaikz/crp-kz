// Параллельное формирование напоминаний на настоящем Postgres: кнопка и крон одновременно не дублируют письма.
// Без TEST_DATABASE_URL тесты пропускаются (PGlite однопоточен).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { planReminders } from '../../src/lib/reminders';

const PG = Boolean(process.env.TEST_DATABASE_URL?.trim());
const skip = PG ? false : 'нужен настоящий Postgres: TEST_DATABASE_URL';
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-20T12:00:00+05:00');

let db: TestDb;

before(async () => {
  if (!PG) return;
  db = await createTestDb();
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES ('orgA', 'crp', 'ЦРП', 'owner', 1)`;
  await db.sql`INSERT INTO courses (id, slug, title, visibility, status, created_at, updated_at)
    VALUES ('c1', 'c1', ${db.json({ ru: 'Курс' })}, 'public', 'published', 1, 1)`;
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('mgr', 'mgr@x.kz', 'Руководитель', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES ('orgA', 'mgr', 'manager', 1)`;
  for (let i = 0; i < 12; i++) {
    const id = `l${i}`;
    await db.sql`INSERT INTO users (id, email, name, created_at) VALUES (${id}, ${id + '@x.kz'}, ${'Сотрудник ' + i}, 1)`;
    await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES ('orgA', ${id}, 'member', 1)`;
    // шесть просроченных и шесть со скорым сроком
    const dueAt = i < 6 ? NOW - 2 * DAY : NOW + 2 * DAY;
    await db.sql`INSERT INTO enrollments (id, user_id, course_id, source, org_id, due_at, created_at, updated_at)
      VALUES (${'e' + i}, ${id}, 'c1', 'assignment', 'orgA', ${dueAt}, 1, 1)`;
  }
});
after(async () => {
  if (!PG) return;
  await db.close();
});

test('два planReminders параллельно: каждое письмо ровно один раз, счётчики в сумме без повторов', { skip }, async () => {
  const [a, b] = await Promise.all([
    planReminders({ nowMs: NOW, actorId: null }),
    planReminders({ nowMs: NOW, actorId: null }),
  ]);
  assert.ok(!a.disabled && !b.disabled);
  if (a.disabled || b.disabled) return;
  assert.equal(a.overdue + b.overdue, 6);
  assert.equal(a.dueSoon + b.dueSoon, 6);
  assert.equal(a.digests + b.digests, 1);

  const dupes = await db.sql<{ dedupeKey: string; n: number }>`
    SELECT dedupe_key, count(*) AS n FROM mail_outbox GROUP BY dedupe_key HAVING count(*) > 1`;
  assert.deepEqual(dupes, []);
  const [total] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox`;
  assert.equal(total?.n, 13);
});
