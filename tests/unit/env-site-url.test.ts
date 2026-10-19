// siteUrlConfigured: адрес задан явно; вне демо — только https:// (D-025).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDemo, siteUrlConfigured } from '../../src/lib/env';

const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x@h/db' };

test('вне демо нужен явный https-адрес', () => {
  assert.equal(siteUrlConfigured({ ...prod }), false, 'не задан');
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: '' }), false, 'пустой');
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: '   ' }), false, 'пробелы');
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: 'http://learn.crp.kz' }), false, 'http');
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }), false, 'localhost');
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: 'learn.crp.kz' }), false, 'без схемы');
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: 'ftp://learn.crp.kz' }), false, 'не http');
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: 'https://learn.crp.kz' }), true);
  assert.equal(siteUrlConfigured({ ...prod, NEXT_PUBLIC_SITE_URL: 'https://learn.crp.kz/' }), true);
});

test('в демо достаточно любого явного http(s)-адреса, без адреса — нет', () => {
  const demo = { NODE_ENV: 'development' };
  assert.equal(isDemo(demo), true);
  assert.equal(siteUrlConfigured(demo), false, 'запасной localhost не считается настроенным');
  assert.equal(siteUrlConfigured({ ...demo, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }), true);
  assert.equal(siteUrlConfigured({ ...demo, NEXT_PUBLIC_SITE_URL: 'https://demo.example' }), true);
  assert.equal(siteUrlConfigured({ ...demo, NEXT_PUBLIC_SITE_URL: 'ftp://x' }), false);
});

test('isDemo принимает окружение параметром', () => {
  assert.equal(isDemo({ NODE_ENV: 'production' }), false, 'production без DATABASE_URL и DEMO_MODE');
  assert.equal(isDemo({ NODE_ENV: 'production', DEMO_MODE: '1' }), true);
  assert.equal(isDemo({ NODE_ENV: 'production', DEMO_MODE: '1', DATABASE_URL: 'postgres://x' }), true);
  assert.equal(isDemo({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }), false);
  assert.equal(isDemo({ NODE_ENV: 'production', VERCEL: '1' }), true, 'превью на Vercel');
  assert.equal(isDemo({ NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: 'postgres://x' }), false);
  assert.equal(isDemo({ NODE_ENV: 'test' }), true);
  assert.equal(isDemo({}), true, 'NODE_ENV не production');
});
