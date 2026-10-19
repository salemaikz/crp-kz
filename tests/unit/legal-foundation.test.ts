// Каркас юрдокументов: типы и константы согласий. Реестр с версиями — legal-registry.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
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
