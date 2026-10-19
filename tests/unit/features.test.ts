// Флаги функций (D-025): выключатель × демо/production × условия готовности.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEATURES, featureBlockers, isFeatureActive, isFeatureEnabled, type FeatureName } from '../../src/lib/features';

const MAIL: readonly FeatureName[] = ['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS'];
const DEMO = { NODE_ENV: 'development' };
const PROD = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x@h/db' };
const HTTPS = { NEXT_PUBLIC_SITE_URL: 'https://learn.crp.kz' };

function quiet<T>(fn: () => T): T {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

test('шесть флагов', () => {
  assert.deepEqual([...FEATURES], ['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS', 'UPLOADS', 'LEGAL', 'CERT_PDF']);
});

// первым среди проверок значений: предупреждение один раз на процесс и флаг
test('неверное значение пишет одно предупреждение на процесс', () => {
  const warn = console.warn;
  const calls: unknown[] = [];
  console.warn = (...a: unknown[]) => void calls.push(a);
  try {
    isFeatureEnabled('CERT_PDF', { ...PROD, FEATURE_CERT_PDF: 'maybe' });
    isFeatureEnabled('CERT_PDF', { ...PROD, FEATURE_CERT_PDF: 'maybe' });
    assert.equal(calls.length, 1);
    assert.match(String(calls[0]), /FEATURE_CERT_PDF/);
  } finally {
    console.warn = warn;
  }
});

test('выключатель: 1 / 0 / пусто / не задан / другое значение × демо и production', () => {
  for (const f of FEATURES) {
    const k = `FEATURE_${f}`;
    for (const [mode, env] of [['демо', DEMO], ['production', PROD]] as const) {
      assert.equal(isFeatureEnabled(f, { ...env, [k]: '1' }), true, `${f} ${mode} =1`);
      assert.equal(isFeatureEnabled(f, { ...env, [k]: '0' }), false, `${f} ${mode} =0`);
      assert.equal(isFeatureEnabled(f, { ...env, [k]: ' 1 ' }), true, `${f} ${mode} пробелы`);
      assert.equal(quiet(() => isFeatureEnabled(f, { ...env, [k]: 'yes' })), false, `${f} ${mode} =yes: fail closed`);
      assert.equal(quiet(() => isFeatureEnabled(f, { ...env, [k]: 'true' })), false, `${f} ${mode} =true`);
    }
    assert.equal(isFeatureEnabled(f, { ...DEMO }), true, `${f} демо, не задан`);
    assert.equal(isFeatureEnabled(f, { ...DEMO, [k]: '' }), true, `${f} демо, пусто`);
    assert.equal(isFeatureEnabled(f, { ...PROD }), false, `${f} production, не задан`);
    assert.equal(isFeatureEnabled(f, { ...PROD, [k]: '' }), false, `${f} production, пусто`);
  }
});

test('демо: все шесть флагов активны, выключатель 0 гасит', () => {
  for (const f of FEATURES) {
    assert.equal(isFeatureActive(f, { ...DEMO }), true, f);
    assert.deepEqual(featureBlockers(f, { ...DEMO }), [], f);
    assert.equal(isFeatureActive(f, { ...DEMO, [`FEATURE_${f}`]: '0' }), false, `${f} =0`);
    assert.deepEqual(featureBlockers(f, { ...DEMO, [`FEATURE_${f}`]: '0' }), ['flag_off'], `${f} блокеры в демо`);
  }
  // DEMO_MODE=1 на production-окружении — тоже демо
  assert.equal(isFeatureActive('LEGAL', { ...PROD, DEMO_MODE: '1' }), true);
});

test('production без переменных: все флаги неактивны', () => {
  for (const f of FEATURES) assert.equal(isFeatureActive(f, { ...PROD }), false, f);
});

test('production с FEATURE_*=1: почта не работает без транспорта (outbox) и без https-адреса', () => {
  for (const f of MAIL) {
    const on = { ...PROD, [`FEATURE_${f}`]: '1' };
    assert.deepEqual(featureBlockers(f, on), ['mail_outbox', 'site_url'], f);
    assert.equal(isFeatureActive(f, on), false, f);
    // адрес есть, но транспорт пока только outbox — всё равно выключено
    assert.equal(isFeatureActive(f, { ...on, ...HTTPS }), false, `${f} с https`);
    assert.equal(isFeatureActive(f, { ...on, ...HTTPS, MAIL_TRANSPORT: 'smtp' }), false, `${f} smtp пока не поддержан`);
    assert.deepEqual(featureBlockers(f, { ...on, ...HTTPS }), ['mail_outbox'], `${f} остаётся только транспорт`);
  }
});

test('production: CERT_PDF требует https-адрес', () => {
  const on = { ...PROD, FEATURE_CERT_PDF: '1' };
  assert.equal(isFeatureActive('CERT_PDF', on), false);
  assert.deepEqual(featureBlockers('CERT_PDF', on), ['site_url']);
  assert.equal(isFeatureActive('CERT_PDF', { ...on, NEXT_PUBLIC_SITE_URL: 'http://learn.crp.kz' }), false, 'http');
  assert.equal(isFeatureActive('CERT_PDF', { ...on, ...HTTPS }), true);
  assert.equal(isFeatureActive('CERT_PDF', { ...PROD, ...HTTPS }), false, 'без выключателя');
  assert.deepEqual(featureBlockers('CERT_PDF', { ...PROD, ...HTTPS }), ['flag_off']);
});

test('production: LEGAL с пустым реестром неактивен, UPLOADS не имеет условий готовности', () => {
  const legal = { ...PROD, FEATURE_LEGAL: '1' };
  assert.equal(isFeatureActive('LEGAL', legal), false);
  assert.deepEqual(featureBlockers('LEGAL', legal), ['legal_not_approved']);
  assert.deepEqual(featureBlockers('LEGAL', { ...PROD }), ['flag_off', 'legal_not_approved']);

  assert.equal(isFeatureActive('UPLOADS', { ...PROD, FEATURE_UPLOADS: '1' }), true);
  assert.deepEqual(featureBlockers('UPLOADS', { ...PROD }), ['flag_off']);
});

test('параметр today передаётся в проверку юрдокументов', () => {
  // реестр пуст: при любой дате документы не опубликованы
  assert.equal(isFeatureActive('LEGAL', { ...PROD, FEATURE_LEGAL: '1' }, { today: '2099-01-01' }), false);
});
