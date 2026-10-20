// Проверка окружения production: каждое правило отдельно, чистое окружение, вывод без значений.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkProductionEnv, formatIssues, hasErrors } from '../../src/lib/ops/preflight';

const CLEAN: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://crp_app:s3cr3t-pass@127.0.0.1:5432/crp?sslmode=require',
  SESSION_SECRET: 'x'.repeat(48),
  NEXT_PUBLIC_SITE_URL: 'https://learn.example.org',
  TRUSTED_PROXY_HOPS: '1',
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'key',
  NEXT_TELEMETRY_DISABLED: '1',
  FEATURE_PASSWORD_RESET: '0',
  FEATURE_EMAIL_VERIFY: '0',
  FEATURE_REMINDERS: '0',
  FEATURE_UPLOADS: '0',
  FEATURE_LEGAL: '0',
  FEATURE_CERT_PDF: '0',
};

function codes(over: Record<string, string | undefined>, level?: 'error' | 'warn'): string[] {
  const env = { ...CLEAN, ...over };
  return checkProductionEnv(env)
    .filter((i) => !level || i.level === level)
    .map((i) => i.code);
}

test('чистое production-окружение: ни ошибок, ни предупреждений', () => {
  assert.deepEqual(checkProductionEnv(CLEAN), []);
});

const ERRORS: [string, Record<string, string | undefined>][] = [
  ['demo_mode_set', { DEMO_MODE: '1' }],
  ['pglite_dir_set', { PGLITE_DIR: '/x' }],
  ['migrations_dir_set', { MIGRATIONS_DIR: '/x' }],
  ['database_url_missing', { DATABASE_URL: undefined }],
  ['database_url_not_postgres', { DATABASE_URL: 'mysql://u@h/db?sslmode=require' }],
  ['database_url_not_postgres', { DATABASE_URL: 'не адрес' }],
  ['database_url_no_ssl', { DATABASE_URL: 'postgres://crp_app:p@127.0.0.1/crp' }],
  ['database_url_no_ssl', { DATABASE_URL: 'postgres://crp_app:p@127.0.0.1/crp?sslmode=disable' }],
  ['database_url_privileged_user', { DATABASE_URL: 'postgres://postgres:p@127.0.0.1/crp?sslmode=require' }],
  ['database_url_privileged_user', { DATABASE_URL: 'postgres://crp_owner:p@127.0.0.1/crp?sslmode=require' }],
  ['database_url_privileged_user', { DATABASE_URL: 'postgres://own1:p@127.0.0.1/crp?sslmode=require', DB_OWNER_ROLE: 'own1' }],
  ['session_secret_weak', { SESSION_SECRET: 'short' }],
  ['session_secret_weak', { SESSION_SECRET: undefined }],
  ['site_url_not_https', { NEXT_PUBLIC_SITE_URL: 'http://learn.example.org' }],
  ['site_url_not_https', { NEXT_PUBLIC_SITE_URL: undefined }],
  ['site_url_not_https', { NEXT_PUBLIC_SITE_URL: 'не адрес' }],
  ['site_url_local', { NEXT_PUBLIC_SITE_URL: 'https://localhost' }],
  ['proxy_hops_not_1', { TRUSTED_PROXY_HOPS: '0' }],
  ['proxy_hops_not_1', { TRUSTED_PROXY_HOPS: undefined }],
  ['trust_x_real_ip_set', { TRUST_X_REAL_IP: '1' }],
  ['auto_migrate_on', { DB_MIGRATE_ON_START: '1' }],
];

for (const [code, over] of ERRORS) {
  test(`ERROR ${code}: ${JSON.stringify(Object.keys(over))}`, () => {
    const got = checkProductionEnv({ ...CLEAN, ...over });
    assert.ok(
      got.some((i) => i.level === 'error' && i.code === code),
      `ожидали ${code}, получили ${JSON.stringify(got)}`,
    );
  });
}

test('SEED_DEMO=1 в production — WARN, а не ERROR', () => {
  assert.deepEqual(codes({ SEED_DEMO: '1' }), ['seed_demo_set']);
  assert.equal(hasErrors(checkProductionEnv({ ...CLEAN, SEED_DEMO: '1' })), false);
});

test('WARN: нет ключа server actions, телеметрия не выключена', () => {
  assert.deepEqual(codes({ NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: undefined }), ['server_actions_key_missing']);
  assert.deepEqual(codes({ NEXT_TELEMETRY_DISABLED: undefined }), ['telemetry_on']);
});

test('WARN feature_on:<NAME> для каждого включённого флага', () => {
  assert.ok(codes({ FEATURE_REMINDERS: '1' }, 'warn').includes('feature_on:REMINDERS'));
  assert.ok(codes({ FEATURE_UPLOADS: '1' }, 'warn').includes('feature_on:UPLOADS'));
  assert.ok(!codes({ FEATURE_UPLOADS: '0' }).some((c) => c.startsWith('feature_on:')));
  // не 1 и не 0 — выключено (fail closed), предупреждения нет
  assert.ok(!codes({ FEATURE_UPLOADS: 'yes' }).includes('feature_on:UPLOADS'));
});

test('WARN feature_blocked: флаг включён, а условия готовности не выполнены', () => {
  const c = codes({ FEATURE_PASSWORD_RESET: '1' }, 'warn');
  assert.ok(c.includes('feature_blocked:PASSWORD_RESET:mail_outbox'));
});

test('включённые EMAIL_VERIFY и LEGAL — отдельное предупреждение о предложенных правилах (D-032, D-035)', () => {
  assert.ok(codes({ FEATURE_EMAIL_VERIFY: '1' }, 'warn').includes('proposed_rules:EMAIL_VERIFY'));
  assert.ok(codes({ FEATURE_LEGAL: '1' }, 'warn').includes('proposed_rules:LEGAL'));
  assert.ok(!codes({ FEATURE_REMINDERS: '1' }, 'warn').some((c) => c.startsWith('proposed_rules:')));
  assert.equal(hasErrors(checkProductionEnv({ ...CLEAN, FEATURE_LEGAL: '1', FEATURE_EMAIL_VERIFY: '1' })), false);
});

test('вывод не содержит значений переменных', () => {
  const marker = 'SECRET-MARKER-9f3a';
  const env = {
    ...CLEAN,
    DATABASE_URL: `postgres://postgres:${marker}@db.internal.example/crp?sslmode=disable`,
    SESSION_SECRET: marker.slice(0, 8),
    NEXT_PUBLIC_SITE_URL: `http://${marker}.example`,
    TRUSTED_PROXY_HOPS: marker,
    FEATURE_LEGAL: '1',
    DB_OWNER_ROLE: marker.toLowerCase(),
  };
  const issues = checkProductionEnv(env);
  assert.ok(issues.length > 3);
  const text = JSON.stringify(issues) + formatIssues(issues).join('\n');
  assert.ok(!text.includes(marker));
  assert.ok(!text.toLowerCase().includes('internal.example'));
  for (const i of issues) assert.match(i.code, /^[a-z_0-9]+(:[A-Za-z_]+){0,2}$/);
});

test('formatIssues: ERROR/WARN <код>', () => {
  assert.deepEqual(
    formatIssues([
      { level: 'error', code: 'a_b' },
      { level: 'warn', code: 'feature_on:LEGAL' },
    ]),
    ['ERROR a_b', 'WARN feature_on:LEGAL'],
  );
});
