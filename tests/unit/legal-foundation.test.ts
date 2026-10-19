// Каркас юрдокументов: типы и функции реестра (версии появятся в задаче 1B).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  currentVersion,
  findVersion,
  legalPublishable,
  LEGAL_VERSIONS,
  versionsOf,
  versionsToken,
} from '../../src/lib/legal/registry';
import { CHECKOUT_CONSENTS, CONSENT_DOC, docKindFromSlug, LEGACY_CONSENT_VERSION, REGISTER_CONSENTS } from '../../src/lib/legal/types';

test('docKindFromSlug: только точные сегменты', () => {
  assert.equal(docKindFromSlug('offer'), 'offer');
  assert.equal(docKindFromSlug('pd-consent'), 'pd_consent');
  for (const bad of ['../offer', 'OFFER', 'pd_consent', '', 'offer/', 'unknown']) assert.equal(docKindFromSlug(bad), null, bad);
});

test('согласия формы: что принимается при регистрации и заказе', () => {
  assert.deepEqual([...REGISTER_CONSENTS], ['pd_processing']);
  assert.deepEqual([...CHECKOUT_CONSENTS], ['offer', 'pd_processing']);
  assert.equal(LEGACY_CONSENT_VERSION, '2026-10-19');
  assert.equal(CONSENT_DOC.cross_border, null);
});

test('пустой реестр: версий нет, публиковать нечего', () => {
  assert.equal(LEGAL_VERSIONS.length, 0);
  assert.deepEqual(versionsOf('offer'), []);
  assert.equal(findVersion('offer', '2026-10-20'), null);
  assert.equal(currentVersion('offer', { allowDrafts: true }), null);
  assert.equal(currentVersion('offer', { allowDrafts: false, today: '2099-01-01' }), null);
  assert.equal(legalPublishable('2099-01-01'), false);
});

test('versionsToken детерминирован: сортировка по документу, дубли и cross_border отбрасываются', () => {
  const a = versionsToken(['pd_processing', 'offer'], { allowDrafts: true });
  const b = versionsToken(['offer', 'pd_processing', 'offer', 'cross_border'], { allowDrafts: true });
  assert.equal(a, b);
  assert.equal(a, 'offer@none;pd_consent@none');
  assert.equal(versionsToken([], { allowDrafts: true }), '');
});
