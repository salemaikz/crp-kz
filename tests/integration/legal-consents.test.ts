// Согласия: подготовка текстов, токен версий, запись в транзакции и чтение для админки.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import {
  consentTokenFresh,
  insertConsents,
  listUserConsents,
  prepareConsents,
} from '../../src/lib/legal/consents';
import { currentVersion, versionsToken } from '../../src/lib/legal/registry';
import { normalizeLegalSource } from '../../src/lib/legal/source';
import { legalFileRel, loadLegalText } from '../../src/lib/legal/texts';
import { CHECKOUT_CONSENTS, LEGACY_CONSENT_VERSION, REGISTER_CONSENTS, type LegalVersion } from '../../src/lib/legal/types';

const ROOT = join(import.meta.dirname, '..', '..');
let db: TestDb;
const saved = process.env.FEATURE_LEGAL;

before(async () => {
  db = await createTestDb();
  for (const u of ['u1', 'u2']) {
    await db.sql`INSERT INTO users (id, email, name, created_at) VALUES (${u}, ${u + '@example.test'}, ${'Имя ' + u}, 1)`;
  }
});
after(async () => {
  await db.close();
});
afterEach(() => {
  if (saved === undefined) delete process.env.FEATURE_LEGAL;
  else process.env.FEATURE_LEGAL = saved;
});

// в тестах isDemo() = true: LEGAL включён без условий готовности
const legalOn = () => {
  process.env.FEATURE_LEGAL = '1';
};
const legalOff = () => {
  process.env.FEATURE_LEGAL = '0';
};

test('LEGAL включён: согласие записывается с версией, языком, контекстом и хэшем, копия текста в legal_texts', async () => {
  legalOn();
  const prepared = await prepareConsents(REGISTER_CONSENTS, 'kz');
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]?.locale, 'kz');
  await db.tx((sql) => insertConsents(sql, { userId: 'u1', orderId: null, context: 'register', at: 100, consents: prepared }));

  const [c] = await db.sql<{ kind: string; version: string; locale: string; context: string; textSha256: string }>`
    SELECT kind, version, locale, context, text_sha256 FROM consents WHERE user_id = 'u1'`;
  assert.equal(c?.kind, 'pd_processing');
  assert.equal(c?.version, '2026-10-20');
  assert.equal(c?.locale, 'kz');
  assert.equal(c?.context, 'register');
  const v = currentVersion('pd_consent', { allowDrafts: true }) as LegalVersion;
  assert.equal(c?.textSha256, v.sha256.kz);

  const [t] = await db.sql<{ body: string; draft: boolean; locale: string }>`SELECT body, draft, locale FROM legal_texts WHERE sha256 = ${v.sha256.kz}`;
  assert.equal(t?.body, normalizeLegalSource(readFileSync(join(ROOT, legalFileRel(v, 'kz')), 'utf8')));
  assert.equal(t?.draft, true);
  assert.equal(t?.locale, 'kz');
});

test('повтор с тем же текстом не дублирует legal_texts, согласия добавляются', async () => {
  legalOn();
  const prepared = await prepareConsents(CHECKOUT_CONSENTS, 'ru');
  assert.deepEqual(prepared.map((p) => p.kind), ['offer', 'pd_processing']);
  for (const orderId of [null, null]) {
    await db.tx((sql) => insertConsents(sql, { userId: 'u2', orderId, context: 'checkout', at: 200, consents: prepared }));
  }
  const texts = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM legal_texts WHERE locale = 'ru'`;
  assert.equal(texts[0]?.n, 2, 'offer и pd_consent на ru, по одной строке');
  const rows = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM consents WHERE user_id = 'u2'`;
  assert.equal(rows[0]?.n, 4);
});

test('LEGAL выключен: легаси-версия без текста, text_sha256 NULL, в legal_texts ничего не пишется', async () => {
  legalOff();
  const textsBefore = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM legal_texts`;
  const prepared = await prepareConsents(REGISTER_CONSENTS, 'ru');
  assert.deepEqual(prepared, [{ kind: 'pd_processing', version: LEGACY_CONSENT_VERSION, locale: null, text: null }]);
  await db.tx((sql) => insertConsents(sql, { userId: 'u1', orderId: null, context: 'register', at: 300, consents: prepared }));
  const [c] = await db.sql<{ version: string; textSha256: string | null; locale: string | null }>`
    SELECT version, text_sha256, locale FROM consents WHERE user_id = 'u1' AND created_at = 300`;
  assert.equal(c?.version, LEGACY_CONSENT_VERSION);
  assert.equal(c?.textSha256, null);
  assert.equal(c?.locale, null);
  const textsAfter = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM legal_texts`;
  assert.equal(textsAfter[0]?.n, textsBefore[0]?.n);
});

test('токен версий: совпал — свежий, чужой или пустой — нет; при выключенном LEGAL всегда свежий', () => {
  legalOn();
  const token = versionsToken(CHECKOUT_CONSENTS, { allowDrafts: true });
  assert.equal(consentTokenFresh(token, CHECKOUT_CONSENTS), true);
  assert.equal(consentTokenFresh('offer@1999-01-01;pd_consent@1999-01-01', CHECKOUT_CONSENTS), false);
  for (const bad of ['', undefined, null, 42, {}]) assert.equal(consentTokenFresh(bad, CHECKOUT_CONSENTS), false);
  legalOff();
  assert.equal(consentTokenFresh(undefined, CHECKOUT_CONSENTS), true);
});

test('нет казахского хэша — запасной ru с пометкой fallback', async () => {
  const v = currentVersion('refund', { allowDrafts: true }) as LegalVersion;
  const noKz: LegalVersion = { ...v, sha256: { ru: v.sha256.ru, kz: null } };
  const text = await loadLegalText(noKz, 'kz');
  assert.equal(text.locale, 'ru');
  assert.equal(text.fallback, true);
  assert.equal(text.sha256, v.sha256.ru);
  const own = await loadLegalText(v, 'kz');
  assert.equal(own.locale, 'kz');
  assert.equal(own.fallback, false);
});

test('хэш файла не совпал с реестром — ошибка, а не запись с чужим хэшем', async () => {
  const v = currentVersion('refund', { allowDrafts: true }) as LegalVersion;
  const broken: LegalVersion = { ...v, sha256: { ru: 'f'.repeat(64), kz: null } };
  await assert.rejects(loadLegalText(broken, 'ru'), /не совпал/);
});

test('prepareConsents: для вида без документа (cross_border) — отказ', async () => {
  legalOn();
  await assert.rejects(prepareConsents(['cross_border'], 'ru'));
});

test('listUserConsents: свежие первыми, номер заказа и хэш', async () => {
  const rows = await listUserConsents('u1');
  assert.ok(rows.length >= 2);
  assert.ok(rows[0] && rows[1] && rows[0].createdAt >= rows[1].createdAt);
  assert.ok(rows.every((r) => r.orderNumber === null && r.withdrawnAt === null));
  assert.deepEqual(await listUserConsents('нет-такого'), []);
});
