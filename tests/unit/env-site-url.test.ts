// siteUrlConfigured: адрес задан явно; вне демо — только https:// (D-025).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDemo, siteUrl, siteUrlConfigured } from '../../src/lib/env';

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

test('в демо без адреса адрес считается настроенным, явный адрес должен быть корректным http(s)', () => {
  const demo = { NODE_ENV: 'development' };
  assert.equal(isDemo(demo), true);
  assert.equal(siteUrlConfigured(demo), true, 'в демо адрес берётся из окружения хостинга или localhost');
  assert.equal(siteUrlConfigured({ DEMO_MODE: '1', NODE_ENV: 'production', URL: 'https://x.netlify.app' }), true, 'Netlify-демо');
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

test('siteUrl: порядок источников адреса', () => {
  const netlifyDemo = { DEMO_MODE: '1', NODE_ENV: 'production' };
  assert.equal(siteUrl({ ...netlifyDemo, NEXT_PUBLIC_SITE_URL: 'https://a.example/', URL: 'https://n.app' }), 'https://a.example');
  assert.equal(siteUrl({ ...netlifyDemo, URL: 'https://n.app/', VERCEL_URL: 'v.app' }), 'https://n.app', 'Netlify раньше Vercel');
  assert.equal(siteUrl({ ...netlifyDemo, VERCEL_URL: 'v.app' }), 'https://v.app');
  assert.equal(siteUrl({ ...netlifyDemo }), 'http://localhost:3000');
  assert.equal(siteUrl({ ...prod, URL: 'https://n.app' }), 'http://localhost:3000', 'вне демо общая переменная URL не берётся');
  assert.equal(siteUrlConfigured({ ...prod, URL: 'https://n.app' }), false, 'вне демо нужен явный адрес');
});
