// Страницы /legal/* и подвал: поведение флага LEGAL (сценарии в отдельном процессе: нужна подмена модулей).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('страницы документов и подвал: 404 при выключенном LEGAL и в проде с черновиками', () => {
  const env = { ...process.env };
  for (const k of ['DATABASE_URL', 'SESSION_SECRET', 'TEST_DATABASE_URL', 'DEMO_MODE', 'FEATURE_LEGAL']) delete env[k];
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
      path.join(here, 'fixtures/legal-pages.flow.ts'),
    ],
    { env, encoding: 'utf8', timeout: 120_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 4/);
});
