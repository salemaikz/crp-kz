// Реестр юридических документов: хэши файлов, порядок версий, действующая версия, заглушки.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  currentVersion,
  findVersion,
  legalPublishable,
  LEGAL_VERSIONS,
  versionsOf,
  versionsToken,
  visibleVersions,
} from '../../src/lib/legal/registry';
import { legalSha256, normalizeLegalSource } from '../../src/lib/legal/source';
import { legalFileRel } from '../../src/lib/legal/texts';
import { docKindFromSlug, LEGAL_DOC_KINDS, LEGAL_DOC_SLUG } from '../../src/lib/legal/types';

const ROOT = join(import.meta.dirname, '..', '..');

test('хэш каждого файла совпадает с реестром (ru и kz)', () => {
  for (const v of LEGAL_VERSIONS) {
    for (const locale of ['ru', 'kz'] as const) {
      const expected = v.sha256[locale];
      const file = join(ROOT, legalFileRel(v, locale));
      if (expected === null) {
        assert.ok(!existsSync(file), `${v.kind}@${v.version}.${locale}: хэша нет, а файл есть`);
        continue;
      }
      assert.ok(existsSync(file), `нет файла ${file}`);
      const hash = legalSha256(normalizeLegalSource(readFileSync(file, 'utf8')));
      assert.equal(hash, expected, `${v.kind}@${v.version}.${locale}: хэш не совпал`);
    }
  }
});

test('в content/legal нет файлов вне реестра', () => {
  const known = new Set(LEGAL_VERSIONS.flatMap((v) => (['ru', 'kz'] as const).filter((l) => v.sha256[l] !== null).map((l) => legalFileRel(v, l))));
  const found: string[] = [];
  for (const dir of readdirSync(join(ROOT, 'content', 'legal'), { withFileTypes: true })) {
    assert.ok(dir.isDirectory(), `лишний файл ${dir.name}`);
    for (const f of readdirSync(join(ROOT, 'content', 'legal', dir.name))) found.push(join('content', 'legal', dir.name, f));
  }
  assert.deepEqual(found.sort(), [...known].sort());
});

test('версии вида уникальны и идут от новых к старым; у каждого вида есть версия', () => {
  for (const kind of LEGAL_DOC_KINDS) {
    const list = versionsOf(kind);
    assert.ok(list.length > 0, `нет версий ${kind}`);
    const names = list.map((v) => v.version);
    assert.equal(new Set(names).size, names.length, `${kind}: дубли версий`);
    assert.deepEqual([...names].sort().reverse(), names, `${kind}: версии не по убыванию`);
  }
});

test('версия имеет формат даты, effectiveFrom не раньше даты редакции', () => {
  for (const v of LEGAL_VERSIONS) {
    assert.match(v.version, /^\d{4}-\d{2}-\d{2}(-\d{1,2})?$/);
    assert.match(v.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(v.effectiveFrom >= v.version.slice(0, 10), `${v.kind}@${v.version}: effectiveFrom раньше версии`);
  }
});

test('все версии пока черновики-заглушки: legalPublishable() = false при любой дате', () => {
  assert.ok(LEGAL_VERSIONS.every((v) => v.draft));
  assert.equal(legalPublishable(), false);
  assert.equal(legalPublishable('2099-01-01'), false);
});

test('заглушки: пометка «не действует» в начале каждого файла, без реквизитов и сумм', () => {
  for (const v of LEGAL_VERSIONS) {
    for (const locale of ['ru', 'kz'] as const) {
      if (v.sha256[locale] === null) continue;
      const text = readFileSync(join(ROOT, legalFileRel(v, locale)), 'utf8');
      const head = text.split('\n').slice(0, 4).join('\n');
      assert.match(head, locale === 'ru' ? /Черновик, не действует/ : /Жоба, күші жоқ/, `${v.kind}.${locale}`);
      assert.ok(!/\d{12}/.test(text), `${v.kind}.${locale}: похоже на БИН или номер`);
      assert.ok(!/₸|тенге/.test(text), `${v.kind}.${locale}: в заглушке не должно быть сумм`);
    }
  }
});

test('currentVersion: черновик виден только с allowDrafts, будущая дата не действует', () => {
  assert.equal(currentVersion('offer', { allowDrafts: false, today: '2099-01-01' }), null);
  assert.equal(currentVersion('offer', { allowDrafts: true, today: '2099-01-01' })?.version, '2026-10-20');
  assert.equal(currentVersion('offer', { allowDrafts: true, today: '2026-10-19' }), null);
  assert.equal(currentVersion('offer', { allowDrafts: true, today: '2026-10-20' })?.version, '2026-10-20');
  assert.equal(findVersion('offer', '1999-01-01'), null);
  assert.deepEqual(visibleVersions('refund', { allowDrafts: false, today: '2099-01-01' }), []);
  assert.equal(visibleVersions('refund', { allowDrafts: true, today: '2099-01-01' }).length, 1);
});

test('versionsToken: сортировка по виду документа и реальные версии', () => {
  const a = versionsToken(['pd_processing', 'offer'], { allowDrafts: true });
  const b = versionsToken(['offer', 'pd_processing'], { allowDrafts: true });
  assert.equal(a, b);
  assert.match(a, /^offer@\d{4}-\d{2}-\d{2};pd_consent@\d{4}-\d{2}-\d{2}$/);
  // без черновиков действующей версии нет: токен меняется, когда она появится
  assert.equal(versionsToken(['offer'], { allowDrafts: false }), 'offer@none');
});

test('docKindFromSlug отвергает обходы пути и регистр', () => {
  for (const bad of ['../offer', 'OFFER', 'pd_consent', 'offer/..', '%2e%2e']) assert.equal(docKindFromSlug(bad), null, bad);
  for (const kind of LEGAL_DOC_KINDS) assert.equal(docKindFromSlug(LEGAL_DOC_SLUG[kind]), kind);
});

test('страницы документов и подвал проверяют флаг через isLegalEnabled; пути файлов не из параметров запроса', () => {
  for (const rel of ['page.tsx', '[doc]/page.tsx', '[doc]/[version]/page.tsx']) {
    const src = readFileSync(join(ROOT, 'src/app/[locale]/legal', rel), 'utf8');
    assert.match(src, /isLegalEnabled\(\)/, rel);
    assert.match(src, /notFound\(\)/, rel);
    assert.ok(!/process\.env/.test(src), `${rel}: флаг читается мимо isFeatureActive`);
  }
  assert.match(readFileSync(join(ROOT, 'src/components/layout/Footer.tsx'), 'utf8'), /isLegalEnabled\(\)/);
  const texts = readFileSync(join(ROOT, 'src/lib/legal/texts.ts'), 'utf8');
  assert.ok(!/params|searchParams/.test(texts));
});
