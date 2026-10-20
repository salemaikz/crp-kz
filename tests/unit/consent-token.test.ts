import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { preparedMatchToken } from '../../src/lib/auth/consentToken';
import { CHECKOUT_CONSENTS, versionsToken, type PreparedConsent } from '../../src/lib/legal';

// В тестах нет DATABASE_URL — это демо, LEGAL активен (черновики разрешены).
const prep = (kind: PreparedConsent['kind'], version: string): PreparedConsent => ({ kind, version, locale: 'ru', text: null });
const token = versionsToken(CHECKOUT_CONSENTS, { allowDrafts: true });

afterEach(() => {
  delete process.env.FEATURE_LEGAL;
});

test('подготовленные версии совпали с токеном формы', () => {
  const [offer, pd] = token.split(';').map((p) => p.split('@')[1] as string);
  assert.equal(preparedMatchToken([prep('offer', offer as string), prep('pd_processing', pd as string)], token), true);
  assert.equal(preparedMatchToken([prep('pd_processing', pd as string), prep('offer', offer as string)], token), true, 'порядок не важен');
});

test('граница effectiveFrom: версия сменилась между токеном и подготовкой, нет вида, лишний вид, не строка', () => {
  const prepared = [prep('offer', '2099-01-01'), prep('pd_processing', '2026-10-20')];
  assert.equal(preparedMatchToken(prepared, token), false);
  assert.equal(preparedMatchToken([prep('offer', '2026-10-20')], token), false);
  assert.equal(preparedMatchToken([prep('cross_border', '2026-10-20')], token), false);
  assert.equal(preparedMatchToken([], undefined), false);
  assert.equal(preparedMatchToken([], 42), false);
});

test('LEGAL выключен: токена в форме нет, сверка не нужна', () => {
  process.env.FEATURE_LEGAL = '0';
  assert.equal(preparedMatchToken([prep('offer', '2026-10-19')], null), true);
});
