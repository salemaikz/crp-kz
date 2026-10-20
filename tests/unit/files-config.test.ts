// storageConfig, maxBytesFor, quotaConfig: окружение подменяется параметром, а не process.env.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { maxBytesFor, quotaConfig, storageConfig } from '../../src/lib/storage/config';
import { UPLOAD_LIMITS } from '../../src/lib/storage/limits';

const PROD = { NODE_ENV: 'production', DATABASE_URL: 'postgres://example.invalid/db' };
const outside = path.join(os.tmpdir(), 'crp-files-config');

test('демо без STORAGE_DIR — временный каталог', () => {
  const cfg = storageConfig({ DEMO_MODE: '1' });
  assert.equal(cfg.ok, true);
  assert.equal(cfg.ok && cfg.root, path.join(os.tmpdir(), 'crp-demo-files'));
  assert.equal(cfg.ok && cfg.demo, true);
});

test('production без STORAGE_DIR — not_configured (tmpdir не подставляется)', () => {
  assert.deepEqual(storageConfig(PROD), { ok: false, reason: 'not_configured' });
});

test('относительный путь и путь внутри каталога приложения', () => {
  assert.deepEqual(storageConfig({ ...PROD, STORAGE_DIR: 'data/files' }), { ok: false, reason: 'relative_path' });
  assert.deepEqual(storageConfig({ ...PROD, STORAGE_DIR: path.join(process.cwd(), 'storage') }), { ok: false, reason: 'inside_app_dir' });
  assert.deepEqual(storageConfig({ ...PROD, STORAGE_DIR: process.cwd() }), { ok: false, reason: 'inside_app_dir' });
  const ok = storageConfig({ ...PROD, STORAGE_DIR: outside });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.demo, false);
});

test('провайдер s3 пока не реализован', () => {
  assert.deepEqual(storageConfig({ ...PROD, STORAGE_DIR: outside, STORAGE_PROVIDER: 's3' }), { ok: false, reason: 'provider_not_implemented' });
  assert.equal(storageConfig({ ...PROD, STORAGE_DIR: outside, STORAGE_PROVIDER: 'local' }).ok, true);
});

test('maxBytesFor: в демо на Vercel и Netlify — 4 МБ, иначе пределы по виду', () => {
  assert.equal(maxBytesFor('document', { VERCEL: '1' }), UPLOAD_LIMITS.serverlessDemoBytes);
  assert.equal(maxBytesFor('image', { DEMO_MODE: '1', NETLIFY: 'true' }), UPLOAD_LIMITS.serverlessDemoBytes);
  assert.equal(maxBytesFor('document', { DEMO_MODE: '1' }), UPLOAD_LIMITS.documentBytes);
  assert.equal(maxBytesFor('image', { DEMO_MODE: '1' }), UPLOAD_LIMITS.imageBytes);
  // вне демо площадка не влияет: прод только на своём сервере
  assert.equal(maxBytesFor('document', { ...PROD, VERCEL: '1' }), UPLOAD_LIMITS.documentBytes);
});

test('квоты: значения по умолчанию и переопределение; мусор игнорируется', () => {
  assert.deepEqual(quotaConfig({}), { total: UPLOAD_LIMITS.totalQuotaBytesDefault, course: UPLOAD_LIMITS.courseQuotaBytesDefault });
  assert.deepEqual(quotaConfig({ UPLOAD_QUOTA_BYTES: '1000', UPLOAD_COURSE_QUOTA_BYTES: '500' }), { total: 1000, course: 500 });
  assert.deepEqual(quotaConfig({ UPLOAD_QUOTA_BYTES: '-1', UPLOAD_COURSE_QUOTA_BYTES: 'abc' }), {
    total: UPLOAD_LIMITS.totalQuotaBytesDefault,
    course: UPLOAD_LIMITS.courseQuotaBytesDefault,
  });
});
