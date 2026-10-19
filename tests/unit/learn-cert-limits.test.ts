import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNKNOWN_IP } from '../../src/lib/auth/clientIp';
import { CERT_LIMITS, certCheckAllowed } from '../../src/lib/learn/limits';

const T0 = 1_900_000_000_000;

test('certCheckAllowed: известный IP — лимит на IP, номер не важен', () => {
  const ip = '10.2.0.1';
  for (let i = 0; i < CERT_LIMITS.perIp.limit; i++) {
    assert.equal(certCheckAllowed('t-ip', ip, `CRP-2026-AAAA${String(i).padStart(2, '0')}`, T0 + i), true);
  }
  assert.equal(certCheckAllowed('t-ip', ip, 'CRP-2026-ZZZZZZ', T0 + 100), false);
  assert.equal(certCheckAllowed('t-ip', '10.2.0.2', 'CRP-2026-ZZZZZZ', T0 + 100), true); // другой адрес
  assert.equal(certCheckAllowed('t-ip', ip, 'CRP-2026-ZZZZZZ', T0 + CERT_LIMITS.perIp.windowMs + 50), true);
});

test('certCheckAllowed: IP неизвестен — лимит на номер; перебор номеров не блокирует проверку остальным', () => {
  // скрипт перебирает тысячи номеров без известного IP
  for (let i = 0; i < 2000; i++) {
    assert.equal(certCheckAllowed('t-num', UNKNOWN_IP, `CRP-2026-X${String(i).padStart(5, '0')}`, T0 + i), true);
  }
  // настоящий владелец проверяет свой номер — проходит
  assert.equal(certCheckAllowed('t-num', UNKNOWN_IP, 'CRP-2026-ABCDEF', T0 + 3000), true);
  // долбить один номер нельзя; регистр и пробелы не обходят лимит
  for (let i = 1; i < CERT_LIMITS.perNumber.limit; i++) {
    assert.equal(certCheckAllowed('t-num', UNKNOWN_IP, i % 2 ? ' crp-2026-abcdef ' : 'CRP-2026-ABCDEF', T0 + 3000 + i), true);
  }
  assert.equal(certCheckAllowed('t-num', UNKNOWN_IP, 'crp-2026-abcdef', T0 + 3100), false);
  // страница и форма считаются отдельно
  assert.equal(certCheckAllowed('t-num-form', UNKNOWN_IP, 'CRP-2026-ABCDEF', T0 + 3100), true);
});
