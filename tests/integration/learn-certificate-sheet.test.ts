// Лист сертификата: блок QR зависит от qrSrc (сценарии в отдельном процессе: подмена модулей).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('CertificateSheet: QR только при qrSrc', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(
    process.execPath,
    ['--experimental-test-module-mocks', '--no-warnings', '--import', 'tsx', '--import', path.join(here, 'fixtures/css-loader.mjs'), '--test', path.join(here, 'fixtures/learn-certificate-sheet.flow.ts')],
    { env, encoding: 'utf8', timeout: 120_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 2/);
});
