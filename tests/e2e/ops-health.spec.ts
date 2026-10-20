import { expect, test } from '@playwright/test';

// /api/health в демо: публичный, без перенаправления на локаль, без деталей (D-028).

test('health: 200, статус ok, демо, миграции накатаны', async ({ request }) => {
  const res = await request.get('/api/health', { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.mode).toBe('demo');
  expect(body.checks).toEqual({ db: 'ok', migrations: 'ok' });
  expect(typeof body.release).toBe('string');
  expect(typeof body.time).toBe('number');
});

test('health: Cache-Control no-store, ответ не кешируется и не индексируется', async ({ request }) => {
  const res = await request.get('/api/health', { maxRedirects: 0 });
  expect(res.headers()['cache-control']).toContain('no-store');
  expect(res.headers()['x-robots-tag']).toContain('noindex');
});

test('health: путь не перенаправляется на /ru/...', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.url()).toMatch(/\/api\/health$/);
});

test('health: в теле нет строк подключения, паролей и адресов почты', async ({ request }) => {
  const text = await (await request.get('/api/health')).text();
  expect(text).not.toMatch(/postgres|password|@/i);
});
