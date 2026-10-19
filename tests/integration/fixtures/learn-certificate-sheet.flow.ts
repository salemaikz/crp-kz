// Настоящий CertificateSheet: без qrSrc блока QR и картинки нет. Запуск — из learn-certificate-sheet.test.ts.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next-intl/server', {
  namedExports: {
    getTranslations: async () => (key: string) => `sheet.${key}`,
  },
});

const { CertificateSheet } = await import('../../../src/components/learn/CertificateSheet');
const base = { holderName: 'Тест Тестов', courseTitle: 'Курс', issuedAt: 1760000000000, number: 'CRP-2026-TEST01', locale: 'ru' as const };

test('без qrSrc нет блока QR и картинки', async () => {
  const out = renderToStaticMarkup(await CertificateSheet({ ...base, qrSrc: null, verifyHost: null }));
  assert.ok(!out.includes('lrn-cert__qr'));
  assert.ok(!out.includes('src="null"'));
  assert.ok(!out.includes('qrAlt'));
});

test('с qrSrc блок QR и адрес проверки есть', async () => {
  const out = renderToStaticMarkup(await CertificateSheet({ ...base, qrSrc: 'data:image/svg+xml;base64,AAAA', verifyHost: 'learn.crp.kz/ru/cert' }));
  assert.ok(out.includes('lrn-cert__qr') && out.includes('data:image/svg+xml'));
  assert.ok(out.includes('learn.crp.kz/ru/cert'));
});
