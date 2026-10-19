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
