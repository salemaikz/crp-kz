// Server actions входа/регистрации/выхода: сценарии в отдельном процессе (нужен флаг подмены модулей).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('server actions авторизации: ошибки, лимиты, cookie, редиректы', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.SESSION_SECRET;
  delete env.TEST_DATABASE_URL;
  delete env.DEMO_MODE;
  delete env.TRUST_X_REAL_IP;
  env.TRUSTED_PROXY_HOPS = '1'; // один доверенный прокси: IP — последнее значение X-Forwarded-For
  delete env.NODE_TEST_CONTEXT; // иначе дочерний node --test отдаёт отчёт родителю, а не в stdout
  const res = spawnSync(
    process.execPath,
    ['--experimental-test-module-mocks', '--no-warnings', '--import', 'tsx', '--test', path.join(here, 'fixtures/auth-actions.flow.ts')],
    { env, encoding: 'utf8', timeout: 120_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 7/);
});
