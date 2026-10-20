// unverifiedMessage: совет про письмо только при включённых EMAIL_VERIFY/PASSWORD_RESET.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unverifiedMessage } from '../../src/lib/ops/createAdminArgs';

const PHRASE = /письмом или восстановлением пароля/;

test('production с выключенными письмами: без совета про письмо, с --identity-confirmed', () => {
  const t = unverifiedMessage({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://app:x@db.internal:5432/crp',
    FEATURE_EMAIL_VERIFY: '0',
    FEATURE_PASSWORD_RESET: '0',
  });
  assert.ok(t.includes('--identity-confirmed'));
  assert.equal(PHRASE.test(t), false);
});

test('демо: совет про письмо есть', () => {
  const t = unverifiedMessage({});
  assert.ok(t.includes('--identity-confirmed'));
  assert.match(t, PHRASE);
});
