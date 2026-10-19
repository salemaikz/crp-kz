import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { listMigrations, migrate, migrationsDir } from '../../src/lib/db/migrate';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  await db.close();
});

test('миграции учитываются в schema_migrations и не применяются повторно', async () => {
  const files = await listMigrations();
  assert.ok(files.includes('2026-10-19-init.sql'));
  const rows = await db.sql<{ name: string }>`SELECT name FROM schema_migrations ORDER BY name`;
  assert.deepEqual(rows.map((r) => r.name), files);
  assert.deepEqual(await migrate(db), []);
});

test('каждый файл миграции идемпотентен (повторный прогон без ошибок)', async () => {
  for (const f of await listMigrations()) {
    const script = await readFile(path.join(migrationsDir(), f), 'utf8');
    await db.exec(script);
    await db.exec(script);
  }
});

test('схема v1: все таблицы на месте', async () => {
  const rows = await db.sql<{ tableName: string }>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name`;
  const names = rows.map((r) => r.tableName);
  for (const t of [
    'users', 'sessions', 'organizations', 'organization_members', 'courses', 'course_modules', 'lessons',
    'course_offers', 'enrollments', 'lesson_progress', 'quiz_attempts', 'certificates', 'orders', 'consents',
    'audit_log', 'schema_migrations',
  ]) {
    assert.ok(names.includes(t), t);
  }
});

test('ограничения схемы: CHECK и UNIQUE срабатывают', async () => {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'a@x.kz', 'A', 1)`;
  await assert.rejects(db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES ('u2', 'b@x.kz', 'B', 'root', 1)`);
  await assert.rejects(db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('u3', 'a@x.kz', 'C', 1)`);
  await db.sql`
    INSERT INTO courses (id, slug, title, created_at, updated_at) VALUES ('c1', 'c1', ${db.json({ ru: 'К' })}, 1, 1)`;
  await assert.rejects(db.sql`
    INSERT INTO orders (id, number, course_id, amount_kzt, buyer_type, buyer_name, buyer_email, buyer_phone,
                        company_name, company_bin, payment_method, created_at, updated_at)
    VALUES ('o1', 'N1', 'c1', 100, 'company', 'B', 'b@x.kz', '+7', 'ТОО', '12345', 'invoice', 1, 1)`);
  const [c] = await db.sql<{ status: string; visibility: string; sequential: boolean; summary: unknown }>`
    SELECT status, visibility, sequential, summary FROM courses WHERE id = 'c1'`;
  assert.deepEqual(c, { status: 'draft', visibility: 'public', sequential: false, summary: {} });
});

test('users.email_verified_at: есть, по умолчанию NULL', async () => {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('ev1', 'ev1@x.kz', 'E', 1)`;
  const [u] = await db.sql<{ emailVerifiedAt: number | null }>`SELECT email_verified_at FROM users WHERE id = 'ev1'`;
  assert.equal(u?.emailVerifiedAt, null);
  await db.sql`UPDATE users SET email_verified_at = ${Date.now()} WHERE id = 'ev1'`;
  const [v] = await db.sql<{ emailVerifiedAt: number | null }>`SELECT email_verified_at FROM users WHERE id = 'ev1'`;
  assert.equal(typeof v?.emailVerifiedAt, 'number');
});

test('целостность курса: модуль урока и курс прогресса — из того же курса', async () => {
  for (const id of ['ci1', 'ci2']) {
    await db.sql`
      INSERT INTO courses (id, slug, title, created_at, updated_at) VALUES (${id}, ${id}, ${db.json({ ru: id })}, 1, 1)`;
    await db.sql`
      INSERT INTO course_modules (id, course_id, title, created_at) VALUES (${'m-' + id}, ${id}, ${db.json({ ru: 'M' })}, 1)`;
  }
  await db.sql`
    INSERT INTO lessons (id, course_id, module_id, slug, title, created_at, updated_at)
    VALUES ('l-ok', 'ci1', 'm-ci1', 'l', ${db.json({ ru: 'L' })}, 1, 1)`;
  // урок курса ci1 в модуле курса ci2 — отказ
  await assert.rejects(db.sql`
    INSERT INTO lessons (id, course_id, module_id, slug, title, created_at, updated_at)
    VALUES ('l-bad', 'ci1', 'm-ci2', 'l2', ${db.json({ ru: 'L' })}, 1, 1)`);
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('ci-u', 'ci-u@x.kz', 'U', 1)`;
  // прогресс по уроку ci1 с course_id = ci2 — отказ
  await assert.rejects(db.sql`
    INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at) VALUES ('ci-u', 'l-ok', 'ci2', 1)`);
  await db.sql`INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at) VALUES ('ci-u', 'l-ok', 'ci1', 1)`;
  // перенос модуля в другой курс переносит уроки и прогресс (ON UPDATE CASCADE)
  await db.sql`UPDATE course_modules SET course_id = 'ci2' WHERE id = 'm-ci1'`;
  const [l] = await db.sql<{ courseId: string }>`SELECT course_id FROM lessons WHERE id = 'l-ok'`;
  assert.equal(l?.courseId, 'ci2');
  const [p] = await db.sql<{ courseId: string }>`SELECT course_id FROM lesson_progress WHERE lesson_id = 'l-ok'`;
  assert.equal(p?.courseId, 'ci2');
  // удаление урока удаляет прогресс
  await db.sql`DELETE FROM lessons WHERE id = 'l-ok'`;
  assert.equal((await db.sql`SELECT 1 FROM lesson_progress WHERE lesson_id = 'l-ok'`).length, 0);
});
