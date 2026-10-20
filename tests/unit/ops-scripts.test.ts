// deploy.sh и rollback.sh во временном CRP_ROOT: внешние команды (git, npm, node, curl, pm2, rsync)
// подменены bash-заглушками из tests/fixtures/ops-shims. Заглушки пишут события в файл,
// по нему проверяем порядок шагов (ops §7.1). Без bash, jq и flock тесты пропускаются; в CI они есть.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const SHIMS = join(ROOT, 'tests', 'fixtures', 'ops-shims');
const BIN = join(ROOT, 'deploy', 'bin');

const haveTools = process.platform !== 'win32' && spawnSync('sh', ['-c', 'command -v bash jq flock tar find comm sha1sum'], { stdio: 'ignore' }).status === 0;
const opts = { skip: haveTools ? false : 'нужны bash, jq, flock, tar (на этой машине их нет)' };

for (const f of readdirSync(SHIMS)) chmodSync(join(SHIMS, f), 0o755);

const temps: string[] = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

type Ctx = ReturnType<typeof makeCtx>;

function makeCtx() {
  const dir = mkdtempSync(join(tmpdir(), 'crp-ops-'));
  temps.push(dir);
  const root = join(dir, 'srv');
  const etc = join(dir, 'etc');
  const state = join(dir, 'shim-state');
  const log = join(dir, 'events.log');
  for (const d of [join(root, 'repo.git'), join(root, 'shared', 'state'), join(root, 'releases'), etc, state]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, 'shared', 'instance.json'), JSON.stringify({ name: 'crp', port: 3000, configDir: etc, smokePort: 3109 }));
  writeFileSync(join(etc, 'app.env'), 'SESSION_SECRET=<секрет>\n');
  writeFileSync(join(etc, 'migrate.env'), 'MIGRATE_LOCK_TIMEOUT_MS=5000\n');
  writeFileSync(log, '');
  let n = 0;
  return { dir, root, etc, state, log, next: () => `20261020-${100000 + ++n}` };
}

function env(ctx: Ctx, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${SHIMS}:${process.env.PATH ?? ''}`,
    HOME: ctx.dir,
    CRP_ROOT: ctx.root,
    CRP_PM2: 'pm2',
    CRP_SUDO_POSTGRES: '',
    CRP_BACKUP_SCRIPT: join(SHIMS, 'crp-backup'),
    CRP_APP_GROUP: '',
    CRP_POLL_INTERVAL: '0.1',
    CRP_SMOKE_TIMEOUT: '4',
    CRP_HEALTH_TIMEOUT: '3',
    CRP_TS: ctx.next(),
    SHIM_LOG: ctx.log,
    SHIM_STATE: ctx.state,
    SHIM_SMOKE_PORT: '3109',
    // окружение оператора, которое скрипт обязан не пускать в сборку
    DATABASE_URL: 'postgres://operator@127.0.0.1:5432/other',
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

function deploy(ctx: Ctx, tag: string, extra: Record<string, string> = {}, args: string[] = []) {
  return spawnSync('bash', [join(BIN, 'deploy.sh'), tag, ...args], { env: env(ctx, extra), encoding: 'utf8' });
}
function rollback(ctx: Ctx, args: string[] = []) {
  return spawnSync('bash', [join(BIN, 'rollback.sh'), ...args], { env: env(ctx), encoding: 'utf8' });
}

const events = (ctx: Ctx) => readFileSync(ctx.log, 'utf8').split('\n').filter(Boolean);
const count = (ctx: Ctx, e: string) => events(ctx).filter((x) => x === e).length;
const currentId = (ctx: Ctx) => basename(readlinkSync(join(ctx.root, 'current')));
const releases = (ctx: Ctx) => readdirSync(join(ctx.root, 'releases')).sort();
const out = (r: ReturnType<typeof spawnSync>) => `${r.stdout}\n${r.stderr}`;

/** События идут в заданном порядке (между ними могут быть другие). */
function assertOrder(ev: string[], expected: string[]) {
  let from = 0;
  for (const e of expected) {
    const i = ev.indexOf(e, from);
    assert.ok(i >= 0, `нет события «${e}» после позиции ${from}: ${ev.join(' ')}`);
    from = i + 1;
  }
}

test('успешная выкладка: каталог, RELEASE.json, current, порядок шагов', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0');
  assert.equal(r.status, 0, out(r));
  const id = currentId(ctx);
  assert.match(id, /^20261020-\d{6}-v0\.1\.0$/);
  const rel = JSON.parse(readFileSync(join(ctx.root, 'releases', id, 'RELEASE.json'), 'utf8'));
  assert.equal(rel.id, id);
  assert.equal(rel.tag, 'v0.1.0');
  assert.match(rel.sha, /^[0-9a-f]{40}$/);
  assert.equal(typeof rel.builtAt, 'number');
  assert.ok(lstatSync(join(ctx.root, 'releases', id, '.env.production')).isSymbolicLink());
  assert.equal(existsSync(join(ctx.root, 'shared', 'state', 'previous')), false, 'у первой выкладки нет previous');
  assertOrder(events(ctx), ['git:fetch', 'ci', 'npm:ci', 'preflight', 'build', 'rsync', 'status', 'migrate', 'grants', 'smoke:start', 'health:3109:ok', 'reload', 'save', 'health:3000:ok']);
  assert.equal(count(ctx, 'backup:--label pre-deploy-' + id), 0, 'без новых миграций бэкап не нужен');
  assert.match(readFileSync(join(ctx.root, 'shared', 'state', 'deploy.log'), 'utf8'), /deployed 20261020-\d{6}-v0\.1\.0 sha=[0-9a-f]{40}/);
});

test('сборка идёт с недоступным адресом БД и NEXT_DEPLOYMENT_ID, а не с окружением оператора', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0');
  assert.equal(r.status, 0, out(r));
  const buildEnv = readFileSync(join(ctx.state, 'build-env.txt'), 'utf8');
  assert.match(buildEnv, /^DATABASE_URL=postgres:\/\/crp_build_nodb@127\.0\.0\.1:9\//m);
  assert.doesNotMatch(buildEnv, /operator/);
  assert.match(buildEnv, new RegExp(`NEXT_DEPLOYMENT_ID=${currentId(ctx)}`));
});

test('шаг 8: код db:status 3 — бэкап до миграций, и set -e не обрывает скрипт', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0', { SHIM_STATUS_RC: '3' });
  assert.equal(r.status, 0, out(r));
  const id = currentId(ctx);
  const ev = events(ctx);
  assertOrder(ev, ['status', `backup:--label pre-deploy-${id}`, 'migrate', 'grants']);
  assert.match(readFileSync(join(ctx.root, 'shared', 'state', 'deploy.log'), 'utf8'), /migrations=2/);
});

test('шаг 8: любой другой код db:status — стоп, прод не тронут', opts, () => {
  for (const rc of ['1', '2', '7']) {
    const ctx = makeCtx();
    const r = deploy(ctx, 'v0.1.0', { SHIM_STATUS_RC: rc });
    assert.equal(r.status, 2, `rc=${rc}: ${out(r)}`);
    assert.equal(count(ctx, 'migrate'), 0);
    assert.equal(events(ctx).some((e) => e.startsWith('backup:')), false);
    assert.equal(existsSync(join(ctx.root, 'current')), false);
    assert.deepEqual(releases(ctx), [], 'каталог неудавшегося релиза убран');
  }
});

test('preflight с ERROR: код 2, сборки нет, current и reload не тронуты', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0', { SHIM_PREFLIGHT_ERROR: '1' });
  assert.equal(r.status, 2, out(r));
  assert.match(out(r), /ERROR demo_mode_set/);
  assert.equal(count(ctx, 'build'), 0);
  assert.equal(count(ctx, 'reload'), 0);
  assert.equal(existsSync(join(ctx.root, 'current')), false);
});

test('сборка упала: код 2, дальше шаги не идут', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0', { SHIM_BUILD_FAIL: '1' });
  assert.equal(r.status, 2, out(r));
  assert.equal(count(ctx, 'status'), 0);
  assert.equal(count(ctx, 'migrate'), 0);
});

test('миграция упала: код 2, переключения нет', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0', { SHIM_MIGRATE_FAIL: '1' });
  assert.equal(r.status, 2, out(r));
  assert.equal(count(ctx, 'grants'), 0);
  assert.equal(count(ctx, 'smoke:start'), 0);
  assert.equal(existsSync(join(ctx.root, 'current')), false);
});

test('проверка до переключения провалена: код 2, симлинк и PM2 не тронуты', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  const before = currentId(ctx);
  const reloads = count(ctx, 'reload');
  const r = deploy(ctx, 'v0.2.0', { SHIM_SMOKE_FAIL: '1', CRP_SMOKE_TIMEOUT: '1' });
  assert.equal(r.status, 2, out(r));
  assert.equal(currentId(ctx), before);
  assert.equal(count(ctx, 'reload'), reloads);
  assert.deepEqual(releases(ctx), [before], 'неудавшийся релиз убран');
});

test('health после reload провален: код 1, автооткат, reload вызван дважды', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  const first = currentId(ctx);
  const reloadsBefore = count(ctx, 'reload');
  const r = deploy(ctx, 'v0.2.0', { SHIM_FAIL_RELEASE: 'v0.2.0', CRP_HEALTH_TIMEOUT: '1' });
  assert.equal(r.status, 1, out(r));
  assert.equal(currentId(ctx), first, 'current вернулся на прежний релиз');
  assert.equal(count(ctx, 'reload') - reloadsBefore, 2, 'reload новой версии и откат');
  assert.match(readFileSync(join(ctx.root, 'shared', 'state', 'deploy.log'), 'utf8'), /rollback from=\S+v0\.2\.0 to=\S+v0\.1\.0 reason=post-deploy-health/);
});

test('rollback без аргументов — к предыдущему, повторный — обратно', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  const a = currentId(ctx);
  assert.equal(deploy(ctx, 'v0.2.0').status, 0);
  const b = currentId(ctx);
  assert.equal(readFileSync(join(ctx.root, 'shared', 'state', 'previous'), 'utf8').trim(), a);

  const r1 = rollback(ctx);
  assert.equal(r1.status, 0, out(r1));
  assert.equal(currentId(ctx), a);
  assert.equal(readFileSync(join(ctx.root, 'shared', 'state', 'previous'), 'utf8').trim(), b);

  const r2 = rollback(ctx);
  assert.equal(r2.status, 0, out(r2));
  assert.equal(currentId(ctx), b);
});

test('rollback: проверки целевого релиза и причины', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  const a = currentId(ctx);
  assert.equal(rollback(ctx, ['--to', a]).status, 2, 'цель равна текущему');
  assert.equal(rollback(ctx, ['--to', 'нет-такого']).status, 2);
  assert.equal(rollback(ctx, ['--to', '../x']).status, 2, 'путь вместо id');
  assert.equal(rollback(ctx, ['--reason', 'плохая причина; rm']).status, 2);
  assert.equal(rollback(ctx).status, 2, 'откатываться не на что');
});

test('хранение: пять последних релизов, current и previous остаются, статика убирается точечно', opts, () => {
  const ctx = makeCtx();
  const ids: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const r = deploy(ctx, `v0.${i}.0`);
    assert.equal(r.status, 0, out(r));
    ids.push(currentId(ctx));
  }
  assert.deepEqual(releases(ctx), ids.slice(2), 'остались пять последних');
  const chunks = join(ctx.root, 'shared', 'static', '_next', 'static', 'chunks');
  const files = readdirSync(chunks);
  for (const id of ids.slice(0, 2)) assert.equal(files.includes(`app-${id}.js`), false, `статика ${id} должна быть убрана`);
  for (const id of ids.slice(2)) assert.equal(files.includes(`app-${id}.js`), true, `статика ${id} должна остаться`);
  assert.equal(files.includes('common-aaaa.js'), true, 'общий файл живых релизов остался');
});

test('хранение: previous за пределами пяти не удаляется', opts, () => {
  const ctx = makeCtx();
  for (let i = 1; i <= 6; i++) assert.equal(deploy(ctx, `v0.${i}.0`).status, 0);
  const oldest = releases(ctx)[1] ?? '';
  assert.equal(rollback(ctx, ['--to', oldest]).status, 0);
  // previous теперь шестой релиз; выкладка седьмого не должна удалить ни oldest (он current), ни previous
  assert.equal(deploy(ctx, 'v0.7.0').status, 0);
  const prev = readFileSync(join(ctx.root, 'shared', 'state', 'previous'), 'utf8').trim();
  assert.ok(releases(ctx).includes(prev));
});

test('вторая параллельная выкладка: код 4', opts, async () => {
  const ctx = makeCtx();
  const holder = spawn('flock', [join(ctx.root, 'shared', 'state', 'deploy.lock'), 'sleep', '5'], { stdio: 'ignore' });
  try {
    await new Promise((res) => setTimeout(res, 400));
    const r = deploy(ctx, 'v0.1.0');
    assert.equal(r.status, 4, out(r));
    assert.equal(count(ctx, 'npm:ci'), 0);
    assert.equal(rollback(ctx).status, 4);
  } finally {
    holder.kill();
  }
});

test('тег не по шаблону: отказ до git', opts, () => {
  const ctx = makeCtx();
  for (const tag of ['1.0.0', 'v1.0', 'v1.0.0; rm -rf /', 'main', '']) {
    const r = deploy(ctx, tag);
    assert.equal(r.status, 2, `${tag}: ${out(r)}`);
  }
  assert.deepEqual(events(ctx), [], 'ни git, ни сеть не вызывались');
});

test('тег не из основной ветки и красный CI — отказ; --skip-ci-check пропускает CI с предупреждением', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0', { SHIM_NOT_ANCESTOR: '1' }).status, 2);
  assert.equal(deploy(ctx, 'v0.1.0', { SHIM_CI: 'fail' }).status, 2);
  assert.equal(count(ctx, 'npm:ci'), 0);
  const r = deploy(ctx, 'v0.1.0', { SHIM_CI: 'fail' }, ['--skip-ci-check']);
  assert.equal(r.status, 0, out(r));
  assert.match(readFileSync(join(ctx.root, 'shared', 'state', 'deploy.log'), 'utf8'), /проверка CI пропущена/);
});

// --- backup.sh: pg_dump, age, psql и прочее подменены заглушками; проверяем порядок, файлы и статус.

function makeBackupCtx(envExtra = '') {
  const ctx = makeCtx();
  const backups = join(ctx.dir, 'backups');
  const ops = join(ctx.dir, 'ops');
  const storage = join(ctx.dir, 'storage');
  for (const d of [backups, ops, storage]) mkdirSync(d, { recursive: true });
  for (const d of ['daily', 'weekly', 'monthly', 'manual', 'files']) mkdirSync(join(backups, d), { recursive: true });
  const recipients = join(ctx.dir, 'recipients.txt');
  writeFileSync(recipients, `# хранители\nage1${'q'.repeat(58)}\nage1${'w'.repeat(58)}\n`);
  const envFile = join(ctx.dir, 'backup.env');
  writeFileSync(envFile, `BACKUP_DB=crp\nBACKUP_DIR=${backups}\nBACKUP_AGE_RECIPIENTS_FILE=${recipients}\nSTORAGE_DIR=${storage}\n${envExtra}`);
  let n = 0;
  const run = (args: string[] = [], extra: Record<string, string> = {}) =>
    spawnSync('bash', [join(BIN, 'backup.sh'), ...args], {
      env: { ...env(ctx, extra), CRP_BACKUP_ENV: envFile, CRP_OPS_DIR: ops, CRP_BACKUP_TS: `20261020T10${String(++n).padStart(2, '0')}00Z` },
      encoding: 'utf8',
    });
  const status = (name = 'backup-status.json') => JSON.parse(readFileSync(join(ops, name), 'utf8'));
  const list = (d: string) => readdirSync(join(backups, d)).sort();
  return { ctx, backups, ops, storage, recipients, envFile, run, status, list };
}

test('backup.sh: дамп шифруется, рядом контрольная сумма, статус ok, открытого дампа нет', opts, () => {
  const b = makeBackupCtx();
  const r = b.run();
  assert.equal(r.status, 0, out(r));
  const files = b.list('daily');
  assert.equal(files.length, 2, files.join(' '));
  const dump = files.find((f) => f.endsWith('.dump.age'));
  assert.match(dump ?? '', /^crp-\d{8}T\d{6}Z\.dump\.age$/);
  assert.ok(files.includes(`${dump}.sha256`));
  assert.equal(readFileSync(join(b.backups, 'daily', dump ?? ''), 'utf8'), 'AGE-ENCRYPTED:DUMP-CONTENT');
  assert.deepEqual(events(b.ctx).filter((e) => e === 'pg_restore:list' || e === 'age' || e === 'pg_dump'), ['pg_dump', 'pg_restore:list', 'age']);
  const st = b.status();
  assert.equal(st.ok, true);
  assert.equal(st.verified, false);
  assert.equal(st.offsite, false, 'вторая копия не настроена, и статус говорит об этом честно');
  assert.equal(st.file, dump);
  assert.match(r.stdout, /BACKUP_REMOTE не задан/);
});

test('backup.sh: заглушки вместо ключей age - отказ, статус ok=false, файлов нет', opts, () => {
  const b = makeBackupCtx();
  writeFileSync(b.recipients, 'age1<открытый-ключ-хранителя-1>\nage1<открытый-ключ-хранителя-2>\n');
  const r = b.run();
  assert.notEqual(r.status, 0, out(r));
  assert.equal(b.status().ok, false);
  assert.deepEqual(b.list('daily'), []);
  assert.equal(count(b.ctx, 'pg_dump'), 0, 'без ключей дамп даже не снимается');
});

test('backup.sh: сбой pg_dump - код не 0, статус ok=false, временных файлов нет', opts, () => {
  const b = makeBackupCtx();
  const r = b.run([], { SHIM_PGDUMP_FAIL: '1' });
  assert.notEqual(r.status, 0, out(r));
  assert.equal(b.status().ok, false);
  assert.deepEqual(b.list('daily'), []);
});

test('backup.sh --verify-restore: восстановление во временную БД, сверка, удаление', opts, () => {
  const b = makeBackupCtx();
  const r = b.run(['--verify-restore']);
  assert.equal(r.status, 0, out(r));
  assert.equal(b.status().verified, true);
  assertOrder(events(b.ctx), ['pg_dump', 'dropdb:crp_restorecheck', 'createdb:crp_restorecheck', 'pg_restore:restore', 'dropdb:crp_restorecheck', 'age']);
});

test('backup.sh --verify-restore: расхождение таблиц - ошибка, проверочная БД всё равно удалена', opts, () => {
  const b = makeBackupCtx();
  const r = b.run(['--verify-restore'], { SHIM_RESTORE_TABLES_DIFFER: '1' });
  assert.notEqual(r.status, 0, out(r));
  assert.equal(b.status().ok, false);
  assert.deepEqual(b.list('daily'), [], 'непроверенный дамп в ротацию не попадает');
  assert.ok(count(b.ctx, 'dropdb:crp_restorecheck') >= 2, 'удалена и перед созданием, и после сбоя');
});

test('backup.sh --label: разовая копия в manual без ротации; плохая метка - код 2', opts, () => {
  const b = makeBackupCtx('BACKUP_KEEP_DAILY=1\n');
  const r = b.run(['--label', 'pre-deploy-20261020-100000-v0.2.0']);
  assert.equal(r.status, 0, out(r));
  assert.match(b.list('manual')[0] ?? '', /^crp-pre-deploy-20261020-100000-v0\.2\.0-\d{8}T\d{6}Z\.dump\.age$/);
  assert.deepEqual(b.list('daily'), []);
  assert.equal(b.run(['--label', 'Плохая метка; rm']).status, 2);
});

test('backup.sh: ротация оставляет заданное число ежедневных копий', opts, () => {
  const b = makeBackupCtx('BACKUP_KEEP_DAILY=2\n');
  for (let i = 0; i < 4; i++) assert.equal(b.run().status, 0);
  const dumps = b.list('daily').filter((f) => f.endsWith('.dump.age'));
  assert.equal(dumps.length, 2);
  assert.equal(b.list('daily').filter((f) => f.endsWith('.sha256')).length, 2, 'суммы удалённых копий убраны');
});

test('backup.sh: BACKUP_REMOTE задан - вторая копия отправляется и статус offsite=true', opts, () => {
  const b = makeBackupCtx();
  const remote = join(b.ctx.dir, 'remote');
  writeFileSync(b.envFile, `${readFileSync(b.envFile, 'utf8')}BACKUP_REMOTE=${remote}\n`);
  const r = b.run();
  assert.equal(r.status, 0, out(r));
  assert.equal(b.status().offsite, true);
  assert.ok(existsSync(join(remote, 'daily')));
});

test('backup.sh --files: архив файлов, пустое хранилище - нечего делать', opts, () => {
  const b = makeBackupCtx();
  const empty = b.run(['--files']);
  assert.equal(empty.status, 0, out(empty));
  assert.deepEqual(b.list('files'), []);
  writeFileSync(join(b.storage, 'a.bin'), 'x');
  const r = b.run(['--files']);
  assert.equal(r.status, 0, out(r));
  const files = b.list('files').filter((f) => f.endsWith('.tar.gz.age'));
  assert.equal(files.length, 1);
  assert.equal(b.status('files-status.json').ok, true);
});

// --- run-script.sh

function runScript(ctx: Ctx, args: string[], extra: Record<string, string> = {}) {
  return spawnSync('bash', [join(BIN, 'run-script.sh'), ...args], {
    env: { ...env(ctx, extra), CRP_LOCK_DIR: ctx.dir, CRP_NODE: 'echo', CRP_APP_ENV: join(ctx.etc, 'app.env') },
    encoding: 'utf8',
  });
}

function withRelease(ctx: Ctx, script: string) {
  mkdirSync(join(ctx.root, 'releases', 'r1', 'scripts'), { recursive: true });
  writeFileSync(join(ctx.root, 'releases', 'r1', 'scripts', `${script}.ts`), '');
  symlinkSync('releases/r1', join(ctx.root, 'current'));
}

test('run-script.sh: запускает скрипт текущего релиза с env-файлом; нет скрипта - код 0; плохое имя - код 2', opts, () => {
  const ctx = makeCtx();
  withRelease(ctx, 'mail-worker');

  const ok = runScript(ctx, ['mail-worker']);
  assert.equal(ok.status, 0, out(ok));
  assert.match(ok.stdout, /--env-file=\S+app\.env --import tsx scripts\/mail-worker\.ts/);

  const withArgs = runScript(ctx, ['mail-worker', '--', '--email', 'x']);
  assert.match(withArgs.stdout, /scripts\/mail-worker\.ts --email x/);

  const missing = runScript(ctx, ['send-reminders']);
  assert.equal(missing.status, 0, 'крон ставится заранее, скрипт приходит со своим релизом');
  assert.match(missing.stdout, /нет в этом релизе/);

  assert.equal(runScript(ctx, ['../etc/passwd']).status, 2);
  assert.equal(runScript(ctx, []).status, 2);
});

test('run-script.sh: пока предыдущий экземпляр работает, повторный пропускается с кодом 0', opts, async () => {
  const ctx = makeCtx();
  withRelease(ctx, 'files-sweep');
  const holder = spawn('flock', [join(ctx.dir, 'crp-files-sweep.lock'), 'sleep', '5'], { stdio: 'ignore' });
  try {
    await new Promise((res) => setTimeout(res, 400));
    const r = runScript(ctx, ['files-sweep']);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /уже выполняется/);
    assert.doesNotMatch(r.stdout, /--import tsx/);
  } finally {
    holder.kill();
  }
});
