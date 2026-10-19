// Список «Моё обучение» при CERT_PDF: ссылки на PDF (сценарии в отдельном процессе: подмена модулей).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('«Моё обучение»: ссылка на PDF только у сертификата опубликованного курса с пригодным текстом', () => {
  const env = { ...process.env };
  for (const k of ['DATABASE_URL', 'SESSION_SECRET', 'TEST_DATABASE_URL', 'DEMO_MODE', 'FEATURE_CERT_PDF', 'NEXT_PUBLIC_SITE_URL']) delete env[k];
  delete env.NODE_TEST_CONTEXT; // иначе дочерний node --test отдаёт отчёт родителю, а не в stdout
  const res = spawnSync(
    process.execPath,
    [
      '--experimental-test-module-mocks',
      '--no-warnings',
      '--import',
      'tsx',
      '--import',
      path.join(here, 'fixtures/css-loader.mjs'),
      '--test',
      path.join(here, 'fixtures/learn-list-certs.flow.ts'),
    ],
    { env, encoding: 'utf8', timeout: 120_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 4/);
});
