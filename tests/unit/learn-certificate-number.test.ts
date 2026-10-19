import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CERT_ALPHABET,
  CERT_NUMBER_RE,
  generateCertificateNumber,
  normalizeCertificateNumber,
} from '../../src/lib/learn/certificates';
import { certificateVerifyUrl } from '../../src/lib/learn/qr';

test('номер: CRP-<год>-<6 символов алфавита без I, O, 0, 1>', () => {
  assert.equal(CERT_ALPHABET.length, 32);
  for (const bad of 'IO01') assert.equal(CERT_ALPHABET.includes(bad), false, bad);
  for (let i = 0; i < 300; i++) {
    const n = generateCertificateNumber(Date.UTC(2026, 9, 19));
    assert.match(n, CERT_NUMBER_RE);
    assert.match(n, /^CRP-2026-[A-HJ-NP-Z2-9]{6}$/);
  }
});

test('номер: год берётся из даты выдачи, генератор подменяем', () => {
  assert.match(generateCertificateNumber(Date.UTC(2027, 0, 1)), /^CRP-2027-/);
  assert.equal(generateCertificateNumber(Date.UTC(2026, 0, 1), () => 0), 'CRP-2026-AAAAAA');
  assert.equal(generateCertificateNumber(Date.UTC(2026, 0, 1), () => 31), 'CRP-2026-999999');
});

test('номера не повторяются на выборке', () => {
  const seen = new Set(Array.from({ length: 2000 }, () => generateCertificateNumber()));
  assert.ok(seen.size > 1995);
});

test('normalizeCertificateNumber: регистр и пробелы не важны, чужой формат — null', () => {
  assert.equal(normalizeCertificateNumber('  crp-2026-ab23cd '), 'CRP-2026-AB23CD');
  assert.equal(normalizeCertificateNumber('CRP-2026-AB23C'), null);
  assert.equal(normalizeCertificateNumber('CRP-2026-AB23C0'), null); // 0 нет в алфавите
  assert.equal(normalizeCertificateNumber('XYZ-2026-AB23CD'), null);
  assert.equal(normalizeCertificateNumber("CRP-2026-AB23CD'; DROP TABLE"), null);
  assert.equal(normalizeCertificateNumber(undefined), null);
  assert.equal(normalizeCertificateNumber(42), null);
});

test('certificateVerifyUrl: {site}/{locale}/cert/{number} без двойных слэшей', () => {
  assert.equal(certificateVerifyUrl('https://academy.crp.kz/', 'kz', 'CRP-2026-AB23CD'), 'https://academy.crp.kz/kz/cert/CRP-2026-AB23CD');
  assert.equal(certificateVerifyUrl('http://localhost:3000', 'ru', 'CRP-2026-AB23CD'), 'http://localhost:3000/ru/cert/CRP-2026-AB23CD');
});
