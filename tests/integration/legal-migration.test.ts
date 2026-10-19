// Миграция юридических документов: колонки consents, закрытый список видов, FK на legal_texts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { migrationsDir } from '../../src/lib/db/migrate';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  await db.close();
});

const SHA = 'a'.repeat(64);

test('двойной прогон миграции без ошибок', async () => {
  const script = await readFile(path.join(migrationsDir(), '2026-10-20-legal-consents.sql'), 'utf8');
  await db.exec(script);
  await db.exec(script);
});

test('в consents есть locale, context, text_sha256, withdrawn_at', async () => {
  const cols = await db.sql<{ columnName: string }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'consents' AND table_schema = current_schema()`;
  const names = cols.map((c) => c.columnName);
  for (const c of ['locale', 'context', 'text_sha256', 'withdrawn_at']) assert.ok(names.includes(c), c);
});

test('ограничение consents_kind_check ровно одно, чужой вид не вставляется', async () => {
  const rows = await db.sql<{ n: number }>`
    SELECT count(*)::int AS n FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    WHERE c.conname = 'consents_kind_check' AND t.relname = 'consents' AND ns.nspname = current_schema()`;
  assert.equal(rows[0]?.n, 1);
  await assert.rejects(
    db.sql`INSERT INTO consents (id, kind, version, created_at) VALUES ('c-bad', 'foo', '2026-10-19', 1)`,
  );
});

test('text_sha256 без строки в legal_texts отклоняется (FK), с ней — принимается', async () => {
  await assert.rejects(
    db.sql`INSERT INTO consents (id, kind, version, text_sha256, locale, context, created_at)
           VALUES ('c-fk', 'offer', '2026-10-20', ${SHA}, 'ru', 'checkout', 1)`,
  );
  await db.sql`
    INSERT INTO legal_texts (sha256, kind, version, locale, title, body, draft, created_at)
    VALUES (${SHA}, 'offer', '2026-10-20', 'ru', 'Т', '# Т', true, 1)`;
  // согласие с текстом обязано нести язык и контекст (consents_text_context_check)
  await assert.rejects(
    db.sql`INSERT INTO consents (id, kind, version, text_sha256, created_at) VALUES ('c-nolocale', 'offer', '2026-10-20', ${SHA}, 1)`,
  );
  await db.sql`INSERT INTO consents (id, kind, version, text_sha256, locale, context, created_at)
              VALUES ('c-ok', 'offer', '2026-10-20', ${SHA}, 'ru', 'checkout', 1)`;
});

test('legal_texts: хэш — 64 hex, версия и язык проверяются', async () => {
  await assert.rejects(
    db.sql`INSERT INTO legal_texts (sha256, kind, version, locale, title, body, draft, created_at)
           VALUES ('xyz', 'offer', '2026-10-20', 'ru', 'Т', 'б', true, 1)`,
  );
  await assert.rejects(
    db.sql`INSERT INTO legal_texts (sha256, kind, version, locale, title, body, draft, created_at)
           VALUES (${'b'.repeat(64)}, 'offer', 'v1', 'ru', 'Т', 'б', true, 1)`,
  );
  await assert.rejects(
    db.sql`INSERT INTO legal_texts (sha256, kind, version, locale, title, body, draft, created_at)
           VALUES (${'c'.repeat(64)}, 'offer', '2026-10-20', 'en', 'Т', 'б', true, 1)`,
  );
});
