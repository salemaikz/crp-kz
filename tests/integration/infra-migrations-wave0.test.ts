// Миграции волны 0 (почта, файлы, согласия): таблицы, ограничения, типы колонок.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;
before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
    VALUES ('u1', 'u1@x.kz', 'h', 'U', 'learner', 'ru', 1)`;
});
after(async () => {
  await db.close();
});

const dataType = async (table: string, column: string) =>
  (await db.sql<{ dataType: string }>`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}`)[0]?.dataType;

test('таблицы и колонки на месте', async () => {
  const tables = (
    await db.sql<{ tableName: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`
  ).map((r) => r.tableName);
  for (const t of ['auth_tokens', 'mail_outbox', 'files', 'lesson_files', 'legal_texts']) assert.ok(tables.includes(t), t);
  assert.equal(await dataType('courses', 'cover_file_id'), 'text');
  for (const c of ['locale', 'context', 'text_sha256']) assert.equal(await dataType('consents', c), 'text', c);
  assert.equal(await dataType('consents', 'withdrawn_at'), 'bigint');
});

test('типы: аренда воркера — время (BIGINT), размер файла — INTEGER', async () => {
  assert.equal(await dataType('mail_outbox', 'lease_until_at'), 'bigint');
  assert.equal(await dataType('mail_outbox', 'locked_until'), undefined);
  assert.equal(await dataType('files', 'size_bytes'), 'integer');
});

test('mail_outbox: статус, секрет и dedupe_key', async () => {
  const ins = (id: string, over: { status?: string; secret?: string | null; expires?: number | null; dedupe?: string | null } = {}) =>
    db.sql`
      INSERT INTO mail_outbox (id, category, template, locale, user_id, to_email, status, secret, secret_expires_at, dedupe_key, created_at, updated_at)
      VALUES (${id}, 'auth', 'password_reset', 'ru', 'u1', 'u1@x.kz', ${over.status ?? 'held'},
              ${over.secret ?? null}, ${over.expires ?? null}, ${over.dedupe ?? null}, 1, 1)`;
  await ins('m1');
  await ins('m2', { dedupe: null }); // много NULL допустимы
  await ins('m3', { dedupe: 'k' });
  await assert.rejects(ins('m4', { dedupe: 'k' }), (e: { code?: string }) => e.code === '23505');
  await assert.rejects(ins('m5', { status: 'bogus' }), (e: { code?: string }) => e.code === '23514');
  await assert.rejects(ins('m6', { secret: 'raw' }), (e: { code?: string }) => e.code === '23514', 'секрет без срока');
  await ins('m7', { secret: 'raw', expires: 99 });
});

test('files: размер положителен, статус и deleted_at согласованы, ключ хранилища уникален', async () => {
  const sha = 'a'.repeat(64);
  const ins = (id: string, key: string, over: { size?: number; status?: string; deletedAt?: number | null } = {}) =>
    db.sql`
      INSERT INTO files (id, storage, storage_key, purpose, kind, mime, ext, size_bytes, sha256, original_name, status, created_at, deleted_at)
      VALUES (${id}, 'local', ${key}, 'lesson_material', 'document', 'application/pdf', 'pdf', ${over.size ?? 10}, ${sha}, 'a.pdf',
              ${over.status ?? 'active'}, 1, ${over.deletedAt ?? null})`;
  await ins('f1', 'aa/1');
  await assert.rejects(ins('f2', 'aa/2', { size: 0 }), (e: { code?: string }) => e.code === '23514');
  await assert.rejects(ins('f3', 'aa/3', { status: 'deleted' }), (e: { code?: string }) => e.code === '23514');
  await ins('f4', 'aa/4', { status: 'deleted', deletedAt: 5 });
  await assert.rejects(ins('f5', 'aa/1'), (e: { code?: string }) => e.code === '23505');
});

test('consents: вид из закрытого списка, старые строки остаются валидными', async () => {
  const ins = (id: string, kind: string) =>
    db.sql`INSERT INTO consents (id, user_id, kind, version, created_at) VALUES (${id}, 'u1', ${kind}, '2026-10-19', 1)`;
  await ins('c1', 'offer');
  await ins('c2', 'pd_processing');
  await ins('c3', 'cross_border');
  await assert.rejects(ins('c4', 'newsletter'), (e: { code?: string }) => e.code === '23514');
});

test('legal_texts: адресация по хэшу, повторная вставка того же текста не нужна', async () => {
  const ins = (sha: string) =>
    db.sql`INSERT INTO legal_texts (sha256, kind, version, locale, title, body, draft, created_at)
           VALUES (${sha}, 'offer', '2026-10-20', 'ru', 'Оферта', 'Текст', true, 1) ON CONFLICT (sha256) DO NOTHING`;
  await ins('b'.repeat(64));
  await ins('b'.repeat(64));
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM legal_texts`;
  assert.equal(n?.n, 1);
  await assert.rejects(ins('xyz'), (e: { code?: string }) => e.code === '23514');
  // согласие ссылается на точный текст
  await db.sql`INSERT INTO consents (id, user_id, kind, version, locale, context, text_sha256, created_at)
               VALUES ('c5', 'u1', 'offer', '2026-10-20', 'ru', 'checkout', ${'b'.repeat(64)}, 1)`;
  await assert.rejects(
    db.sql`INSERT INTO consents (id, user_id, kind, version, text_sha256, created_at)
           VALUES ('c6', 'u1', 'offer', '2026-10-20', ${'c'.repeat(64)}, 1)`,
    (e: { code?: string }) => e.code === '23503',
  );
});
