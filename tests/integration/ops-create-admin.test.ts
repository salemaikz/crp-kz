// create-admin: createAdmin на тестовой БД (PGlite и Postgres) и разбор аргументов CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createPgliteDb } from '../../src/lib/db/pglite';
import { verifyPassword } from '../../src/lib/auth/password';
import { seed } from '../../src/lib/db/seed';
import { createTestDb } from '../../src/lib/db/testing';
import { ADMIN_PASSWORD_MIN_LENGTH, createAdmin, CreateAdminError, type CreateAdminInput } from '../../src/lib/ops/createAdmin';
import { parseCreateAdminArgs } from '../../src/lib/ops/createAdminArgs';
import { readLine } from '../../src/lib/ops/passwordInput';

const PASSWORD = 'correct-horse-battery';
const base = (over: Partial<CreateAdminInput> = {}): CreateAdminInput => ({
  email: 'First.Admin@Example.org',
  name: 'Первый Администратор',
  locale: 'ru',
  password: PASSWORD,
  promote: false,
  ...over,
});

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof CreateAdminError, 'ожидали CreateAdminError');
    assert.equal(e.code, code);
    return true;
  });
}

async function audit(db: Awaited<ReturnType<typeof createTestDb>>) {
  return db.sql<{ actorId: string | null; action: string; entity: string; entityId: string; meta: Record<string, unknown> }>`
    SELECT actor_id, action, entity, entity_id, meta FROM audit_log ORDER BY created_at, id`;
}

test('создаёт администратора: роль, подтверждённый email, хэш, нормализованный email', async () => {
  const db = await createTestDb();
  try {
    const r = await createAdmin(db, base());
    assert.ok(r.created && !r.promoted && r.orgId === null);
    const [u] = await db.sql<{ email: string; role: string; passwordHash: string; emailVerifiedAt: number | null; locale: string }>`
      SELECT email, role, password_hash, email_verified_at, locale FROM users WHERE id = ${r.userId}`;
    assert.equal(u?.email, 'first.admin@example.org');
    assert.equal(u?.role, 'admin');
    assert.ok(u?.emailVerifiedAt);
    assert.ok(await verifyPassword(PASSWORD, u?.passwordHash));
    assert.ok(!(await verifyPassword('другой-пароль-длинный', u?.passwordHash)));
  } finally {
    await db.close();
  }
});

test('журнал: user.create_admin, actor_id NULL, в meta нет email и имени', async () => {
  const db = await createTestDb();
  try {
    await createAdmin(db, base());
    const rows = await audit(db);
    assert.deepEqual(rows.map((x) => x.action), ['user.create_admin']);
    assert.equal(rows[0]?.actorId, null);
    const text = JSON.stringify(rows);
    assert.ok(!/example\.org/i.test(text));
    assert.ok(!text.includes('Администратор'));
  } finally {
    await db.close();
  }
});

test('повтор без --promote — exists, второго пользователя нет', async () => {
  const db = await createTestDb();
  try {
    await createAdmin(db, base());
    await expectCode(createAdmin(db, base({ email: 'first.admin@example.org' })), 'exists');
    const [n] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    assert.equal(n?.n, 1);
  } finally {
    await db.close();
  }
});

test('--promote: слушатель становится админом, пароль и имя не меняются, журнал — user.role_change', async () => {
  const db = await createTestDb();
  try {
    await db.sql`INSERT INTO users (id, email, password_hash, name, role, locale, email_verified_at, created_at)
      VALUES ('u1', 'learner@example.org', 'hash-as-is', 'Слушатель', 'learner', 'ru', 1, 1)`;
    const r = await createAdmin(db, base({ email: 'learner@example.org', password: undefined, promote: true }));
    assert.ok(r.promoted && !r.created && r.userId === 'u1');
    const [u] = await db.sql<{ role: string; passwordHash: string; name: string }>`SELECT role, password_hash, name FROM users WHERE id = 'u1'`;
    assert.deepEqual(u, { role: 'admin', passwordHash: 'hash-as-is', name: 'Слушатель' });
    const rows = await audit(db);
    assert.deepEqual(rows.map((x) => x.action), ['user.role_change']);
    assert.deepEqual(rows[0]?.meta, { to: 'admin', via: 'cli' });
    // повторное повышение ничего не пишет
    const again = await createAdmin(db, base({ email: 'learner@example.org', password: undefined, promote: true }));
    assert.ok(!again.promoted);
    assert.equal((await audit(db)).length, 1);
  } finally {
    await db.close();
  }
});

test('--promote: неподтверждённый email — unverified, роль не меняется', async () => {
  const db = await createTestDb();
  try {
    await db.sql`INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
      VALUES ('u2', 'stranger@example.org', 'h', 'Чужой', 'learner', 'ru', 1)`;
    await expectCode(createAdmin(db, base({ email: 'stranger@example.org', password: undefined, promote: true })), 'unverified');
    const [u] = await db.sql<{ role: string }>`SELECT role FROM users WHERE id = 'u2'`;
    assert.equal(u?.role, 'learner');
    assert.equal((await audit(db)).length, 0);
  } finally {
    await db.close();
  }
});

test('--promote с паролем не создаёт пользователя; несуществующий — not_found', async () => {
  const db = await createTestDb();
  try {
    await expectCode(createAdmin(db, base({ promote: true })), 'not_found');
    await expectCode(createAdmin(db, base({ promote: true, password: undefined })), 'not_found');
    const [n] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    assert.equal(n?.n, 0);
  } finally {
    await db.close();
  }
});

test('пароль: короче 12 — weak_password, без пароля и без --promote — validation', async () => {
  const db = await createTestDb();
  try {
    assert.equal(ADMIN_PASSWORD_MIN_LENGTH, 12);
    await expectCode(createAdmin(db, base({ password: '12345678901' })), 'weak_password');
    await expectCode(createAdmin(db, base({ password: undefined })), 'validation');
    await createAdmin(db, base({ password: '123456789012' }));
  } finally {
    await db.close();
  }
});

test('неверные email, имя, slug', async () => {
  const db = await createTestDb();
  try {
    await expectCode(createAdmin(db, base({ email: 'не-почта' })), 'validation');
    await expectCode(createAdmin(db, base({ name: '   ' })), 'validation');
    await expectCode(createAdmin(db, base({ name: 'x'.repeat(101) })), 'validation');
    await expectCode(createAdmin(db, base({ ownerOrg: { name: 'Орг', slug: 'Bad Slug' } })), 'bad_slug');
    const [n] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    assert.equal(n?.n, 0, 'ошибка проверки до записи');
  } finally {
    await db.close();
  }
});

test('организация-владелец создаётся один раз; админ — manager; журнал без email', async () => {
  const db = await createTestDb();
  try {
    const org = { name: 'ЦРП', slug: 'crp' };
    const a = await createAdmin(db, base({ ownerOrg: org }));
    assert.ok(a.orgCreated && a.orgId);
    const b = await createAdmin(db, base({ email: 'second@example.org', ownerOrg: { name: 'Другая', slug: 'other' } }));
    assert.ok(!b.orgCreated);
    assert.equal(b.orgId, a.orgId);
    const owners = await db.sql<{ id: string }>`SELECT id FROM organizations WHERE kind = 'owner'`;
    assert.equal(owners.length, 1);
    const members = await db.sql<{ userId: string; role: string }>`
      SELECT user_id, role FROM organization_members WHERE org_id = ${a.orgId} ORDER BY user_id`;
    assert.equal(members.length, 2);
    assert.ok(members.every((m) => m.role === 'manager'));
    const rows = await audit(db);
    assert.deepEqual(
      rows.map((x) => x.action).sort(),
      ['org.create', 'org.member_add', 'org.member_add', 'user.create_admin', 'user.create_admin'],
    );
    assert.ok(rows.every((x) => x.actorId === null));
    assert.ok(!/example\.org/i.test(JSON.stringify(rows)));
  } finally {
    await db.close();
  }
});

test('slug занят клиентской организацией — bad_slug, пользователь не создан', async () => {
  const db = await createTestDb();
  try {
    await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES ('o1', 'taken', 'Клиент', 'client', 1)`;
    await expectCode(createAdmin(db, base({ ownerOrg: { name: 'ЦРП', slug: 'taken' } })), 'bad_slug');
    const [n] = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    assert.equal(n?.n, 0, 'транзакция откатилась целиком');
  } finally {
    await db.close();
  }
});

test('на БД с сидом организация ЦРП из сида переиспользуется', async () => {
  const db = await createTestDb();
  try {
    await seed(db);
    const [seeded] = await db.sql<{ id: string }>`SELECT id FROM organizations WHERE kind = 'owner'`;
    const r = await createAdmin(db, base({ ownerOrg: { name: 'ЦРП', slug: 'crp-new' } }));
    assert.equal(r.orgId, seeded?.id);
    assert.ok(!r.orgCreated);
    const owners = await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM organizations WHERE kind = 'owner'`;
    assert.equal(owners[0]?.n, 1);
  } finally {
    await db.close();
  }
});

test('минимальный набор', () => {
  const r = parseCreateAdminArgs(['--email', 'a@b.kz', '--name', 'Имя']);
  assert.ok(r.ok);
  assert.equal(r.args.locale, 'ru');
  assert.equal(r.args.promote, false);
  assert.equal(r.args.ownerOrg, undefined);
});

test('организация, флаги и форма --ключ=значение', () => {
  const r = parseCreateAdminArgs([
    '--email=a@b.kz',
    '--name=Имя',
    '--locale',
    'kz',
    '--owner-org-name',
    'Орг',
    '--owner-org-slug',
    'org',
    '--password-stdin',
    '--allow-demo',
    '--promote',
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.args.ownerOrg, { name: 'Орг', slug: 'org' });
  assert.equal(r.args.locale, 'kz');
  assert.ok(r.args.passwordStdin && r.args.allowDemo && r.args.promote);
});

test('пароль через аргументы отвергается в любой форме', () => {
  for (const bad of [['--password', 'x'], ['--password=x'], ['--pass', 'x'], ['--PASSWORD', 'x']]) {
    const r = parseCreateAdminArgs(['--email', 'a@b.kz', '--name', 'Имя', ...bad]);
    assert.deepEqual(r, { ok: false, reason: 'password_in_argv' });
  }
});

test('нет email или имени, неверная локаль, лишний аргумент, половина организации — usage', () => {
  const base = ['--email', 'a@b.kz', '--name', 'Имя'];
  assert.deepEqual(parseCreateAdminArgs(['--name', 'Имя']), { ok: false, reason: 'usage' });
  assert.deepEqual(parseCreateAdminArgs(['--email', 'a@b.kz']), { ok: false, reason: 'usage' });
  assert.deepEqual(parseCreateAdminArgs([...base, '--locale', 'en']), { ok: false, reason: 'usage' });
  assert.deepEqual(parseCreateAdminArgs([...base, '--bogus']), { ok: false, reason: 'usage' });
  assert.deepEqual(parseCreateAdminArgs([...base, '--owner-org-name', 'Орг']), { ok: false, reason: 'usage' });
  assert.deepEqual(parseCreateAdminArgs([...base, '--email']), { ok: false, reason: 'usage' });
  // значение, похожее на флаг, — пропущенный аргумент
  assert.deepEqual(parseCreateAdminArgs([...base, '--owner-org-name', '--password-stdin', '--owner-org-slug', 'crp']), { ok: false, reason: 'usage' });
  assert.deepEqual(parseCreateAdminArgs(['--email', 'a@b.kz', '--name', '--promote']), { ok: false, reason: 'usage' });
  assert.deepEqual(parseCreateAdminArgs([...base, '--owner-org-name', '--password=x', '--owner-org-slug', 'crp']), { ok: false, reason: 'password_in_argv' });
});

test('readLine: одна строка, перевод строки не входит', async () => {
  assert.equal(await readLine(Readable.from(['pass-word-12345\nвторая\n'])), 'pass-word-12345');
  assert.equal(await readLine(Readable.from(['abc', 'def\r\n'])), 'abcdef');
  assert.equal(await readLine(Readable.from(['без перевода'])), 'без перевода');
  assert.equal(await readLine(Readable.from([])), '');
});

// --- CLI scripts/create-admin.ts: коды выхода, пароль через stdin, отказ в демо и от пароля в argv ---

const ROOT = path.join(import.meta.dirname, '..', '..');

function runCli(args: string[], extra: Record<string, string>, input?: string) {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(DATABASE_URL|TEST_DATABASE_URL|PGLITE_DIR|NODE_ENV|DEMO_MODE|SEED_DEMO|VERCEL|MIGRATIONS_DIR)$/.test(k)) continue;
    env[k] = v;
  }
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'create-admin.ts'), ...args], {
    cwd: ROOT,
    env: { ...env, ...extra } as NodeJS.ProcessEnv,
    encoding: 'utf8',
    input,
    timeout: 120_000,
  });
}

test('CLI: пароль в argv — код 2 и отказ, пароль не печатается', () => {
  const r = runCli(['--email', 'a@example.org', '--name', 'Имя', '--password', 'very-secret-pass-1'], {});
  assert.equal(r.status, 2);
  assert.ok(!(r.stdout + r.stderr).includes('very-secret-pass-1'));
});

test('CLI: демо без --allow-demo — код 2', () => {
  const r = runCli(['--email', 'a@example.org', '--name', 'Имя', '--password-stdin'], {}, 'correct-horse-battery\n');
  assert.equal(r.status, 2);
});

test('CLI: пароль из stdin, создание, повтор — код 3, email не печатается', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-cli-admin-'));
  try {
    const args = ['--email', 'cli.admin@example.org', '--name', 'Имя', '--password-stdin', '--allow-demo'];
    const ok = runCli(args, { PGLITE_DIR: dir }, 'correct-horse-battery\n');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Администратор создан/);
    assert.ok(!(ok.stdout + ok.stderr).includes('cli.admin@example.org'));
    const again = runCli(args, { PGLITE_DIR: dir }, 'correct-horse-battery\n');
    assert.equal(again.status, 3);
    const weak = runCli(['--email', 'w@example.org', '--name', 'Имя', '--password-stdin', '--allow-demo'], { PGLITE_DIR: dir }, 'short\n');
    assert.equal(weak.status, 2);
    const db = await createPgliteDb(dir);
    try {
      const rows = await db.sql<{ role: string }>`SELECT role FROM users`;
      assert.deepEqual(rows.map((r) => r.role), ['admin']);
      const log = await db.sql<{ action: string; actorId: string | null }>`SELECT action, actor_id FROM audit_log`;
      assert.deepEqual(log, [{ action: 'user.create_admin', actorId: null }]);
    } finally {
      await db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
