// Настройки PDF сертификата: адрес сайта для QR, условия включения флага, лимит частоты.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isFeatureActive } from '../../src/lib/features';
import { CERT_PDF_LIMIT, certPdfAllowed } from '../../src/lib/learn/limits';
import { publicSiteUrl } from '../../src/lib/learn/pdf/data';
import { PdfConfigError } from '../../src/lib/learn/pdf/types';

// production без демо: есть DATABASE_URL и NODE_ENV=production
const PROD = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db.invalid/crp' };

describe('publicSiteUrl', () => {
  it('вне демо без адреса сайта — PdfConfigError (QR не должен вести на localhost)', () => {
    assert.throws(() => publicSiteUrl({ ...PROD }), PdfConfigError);
  });
  it('вне демо с http-адресом — тоже ошибка', () => {
    assert.throws(() => publicSiteUrl({ ...PROD, NEXT_PUBLIC_SITE_URL: 'http://crp.example' }), PdfConfigError);
  });
  it('вне демо с https-адресом — адрес без хвостового слэша', () => {
    assert.equal(publicSiteUrl({ ...PROD, NEXT_PUBLIC_SITE_URL: 'https://crp.example/' }), 'https://crp.example');
  });
  it('в демо без адреса — адрес по умолчанию', () => {
    assert.match(publicSiteUrl({ NODE_ENV: 'development' }), /^https?:\/\//);
  });
});

describe('флаг CERT_PDF', () => {
  it('в демо включён по умолчанию, выключается FEATURE_CERT_PDF=0', () => {
    assert.equal(isFeatureActive('CERT_PDF', { NODE_ENV: 'development' }), true);
    assert.equal(isFeatureActive('CERT_PDF', { NODE_ENV: 'development', FEATURE_CERT_PDF: '0' }), false);
  });
  it('в production выключен сам, а при FEATURE_CERT_PDF=1 нужен https-адрес', () => {
    assert.equal(isFeatureActive('CERT_PDF', { ...PROD }), false);
    assert.equal(isFeatureActive('CERT_PDF', { ...PROD, FEATURE_CERT_PDF: '1' }), false);
    assert.equal(isFeatureActive('CERT_PDF', { ...PROD, FEATURE_CERT_PDF: '1', NEXT_PUBLIC_SITE_URL: 'https://crp.example' }), true);
  });
});

describe('лимит PDF', () => {
  it('10 в минуту на пользователя, пользователи не влияют друг на друга', () => {
    assert.equal(CERT_PDF_LIMIT.limit, 10);
    assert.equal(CERT_PDF_LIMIT.windowMs, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) assert.equal(certPdfAllowed('lim-a', t0 + i).ok, true, `запрос ${i + 1}`);
    const eleventh = certPdfAllowed('lim-a', t0 + 10);
    assert.equal(eleventh.ok, false);
    assert.ok(eleventh.retryAfterMs > 0 && eleventh.retryAfterMs <= 60_000);
    assert.equal(certPdfAllowed('lim-b', t0 + 10).ok, true);
    // окно прошло — снова можно
    assert.equal(certPdfAllowed('lim-a', t0 + 61_000).ok, true);
  });
});

describe('привязка к репозиторию', () => {
  it('маршрут проверяет флаг через isFeatureActive, а не сырой isFeatureEnabled', () => {
    const src = readFileSync('src/app/[locale]/learn/[slug]/certificate/pdf/route.ts', 'utf8');
    assert.match(src, /isFeatureActive\('CERT_PDF'\)/);
    assert.doesNotMatch(src, /isFeatureEnabled/);
  });
  it('скрипт сборки шрифтов не содержит абсолютных путей локальной машины', () => {
    const sh = readFileSync('scripts/fonts/build-pdf-fonts.sh', 'utf8');
    assert.doesNotMatch(sh, /\/(home|tmp|Users)\//);
  });
});
