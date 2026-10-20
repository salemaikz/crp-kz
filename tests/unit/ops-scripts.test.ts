// deploy.sh и rollback.sh во временном CRP_ROOT: внешние команды (git, npm, node, curl, pm2, rsync)
// подменены bash-заглушками из tests/fixtures/ops-shims. Заглушки пишут события в файл,
// по нему проверяем порядок шагов (ops §7.1). Без bash, jq и flock тесты пропускаются; в CI они есть.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, statSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('общая статика читается любым пользователем: файлы o+r, каталоги o+x', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0');
  assert.equal(r.status, 0, out(r));
  const base = join(ctx.root, 'shared', 'static', '_next');
  const walkModes = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        assert.equal(st.mode & 0o005, 0o005, `каталог ${p} недоступен nginx`);
        walkModes(p);
      } else assert.equal(st.mode & 0o004, 0o004, `файл ${p} недоступен nginx`);
    }
  };
  assert.equal(statSync(base).mode & 0o005, 0o005);
  walkModes(base);
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

test('backup.sh: вторая копия — только свои подкаталоги, нечитаемый сосед даёт offsite=false', opts, () => {
  const b = makeBackupCtx();
  const remote = join(b.ctx.dir, 'remote');
  writeFileSync(b.envFile, `${readFileSync(b.envFile, 'utf8')}BACKUP_REMOTE=${remote}\n`);
  // Каталог files принадлежит другому пользователю и закрыт; бэкап БД его не трогает.
  const ok = b.run([], { SHIM_RSYNC_DENY: 'files' });
  assert.equal(ok.status, 0, out(ok));
  assert.equal(b.status().offsite, true);
  assert.equal(existsSync(join(remote, 'files')), false, 'бэкап БД не отправляет files/');
  const bad = b.run([], { SHIM_RSYNC_DENY: 'daily' });
  assert.equal(bad.status, 0, 'сбой второй копии не отменяет локальную');
  assert.equal(b.status().offsite, false);
  assert.match(bad.stdout, /НЕ отправлена/);
});

test('backup.sh --files: свой ключ обязателен, общий ключ БД не подставляется', opts, () => {
  const rsyncLog = (b: ReturnType<typeof makeBackupCtx>) => join(b.ctx.dir, 'rsync.log');
  const withFile = (b: ReturnType<typeof makeBackupCtx>) => writeFileSync(join(b.storage, 'f.txt'), 'x');
  const set = (b: ReturnType<typeof makeBackupCtx>, extra: string) => writeFileSync(b.envFile, `${readFileSync(b.envFile, 'utf8')}${extra}`);

  // свои значения: файлы идут своим ключом и в свой адрес
  const own = makeBackupCtx();
  withFile(own);
  set(own, `BACKUP_REMOTE=${join(own.ctx.dir, 'db-remote')}\nBACKUP_REMOTE_SSH_KEY=/k/db\nBACKUP_FILES_REMOTE=${join(own.ctx.dir, 'files-remote')}\nBACKUP_FILES_REMOTE_SSH_KEY=/k/files\n`);
  const r1 = own.run(['--files'], { SHIM_RSYNC_LOG: rsyncLog(own) });
  assert.equal(r1.status, 0, out(r1));
  const l1 = readFileSync(rsyncLog(own), 'utf8');
  assert.match(l1, /-i \/k\/files /);
  assert.doesNotMatch(l1, /\/k\/db/);
  assert.match(l1, /dst=.*files-remote\/$/m);
  assert.equal(own.status('files-status.json').offsite, true);
  assert.ok(existsSync(join(own.ctx.dir, 'files-remote', 'files')));
  assert.equal(existsSync(join(own.ctx.dir, 'db-remote')), false, 'адрес БД файлы не получают');

  // только общие значения: ключ БД для файлов не подставляется, копия не уходит (D-041)
  const shared = makeBackupCtx();
  withFile(shared);
  set(shared, `BACKUP_REMOTE=${join(shared.ctx.dir, 'db-remote')}\nBACKUP_REMOTE_SSH_KEY=/k/db\n`);
  const r2 = shared.run(['--files'], { SHIM_RSYNC_LOG: rsyncLog(shared) });
  assert.equal(r2.status, 0, out(r2));
  assert.match(r2.stdout, /нужен свой ключ файлов BACKUP_FILES_REMOTE_SSH_KEY \(D-041\)/);
  assert.equal(existsSync(rsyncLog(shared)), false, 'rsync не запускался');
  assert.equal(existsSync(join(shared.ctx.dir, 'db-remote')), false);
  assert.equal(shared.status('files-status.json').offsite, false);

  // ключ файлов совпал с ключом БД: тоже отказ
  const same = makeBackupCtx();
  withFile(same);
  set(same, `BACKUP_REMOTE=${join(same.ctx.dir, 'db-remote')}\nBACKUP_REMOTE_SSH_KEY=/k/db\nBACKUP_FILES_REMOTE_SSH_KEY=/k/db\n`);
  const r4 = same.run(['--files'], { SHIM_RSYNC_LOG: rsyncLog(same) });
  assert.equal(r4.status, 0, out(r4));
  assert.match(r4.stdout, /совпадает с ключом БД/);
  assert.equal(same.status('files-status.json').offsite, false);

  // бэкап БД своего файлового ключа не использует
  const db = makeBackupCtx();
  set(db, `BACKUP_REMOTE=${join(db.ctx.dir, 'db-remote')}\nBACKUP_REMOTE_SSH_KEY=/k/db\nBACKUP_FILES_REMOTE_SSH_KEY=/k/files\n`);
  const r3 = db.run([], { SHIM_RSYNC_LOG: rsyncLog(db) });
  assert.equal(r3.status, 0, out(r3));
  assert.doesNotMatch(readFileSync(rsyncLog(db), 'utf8'), /\/k\/files/);
});

test('backup.sh --files: ключ файлов - ссылка на ключ БД, либо ключ БД читается - отказ (D-041)', opts, () => {
  const rsyncLog = (b: ReturnType<typeof makeBackupCtx>) => join(b.ctx.dir, 'rsync.log');
  const withFile = (b: ReturnType<typeof makeBackupCtx>) => writeFileSync(join(b.storage, 'f.txt'), 'x');
  const set = (b: ReturnType<typeof makeBackupCtx>, extra: string) => writeFileSync(b.envFile, `${readFileSync(b.envFile, 'utf8')}${extra}`);
  const link = makeBackupCtx();
  withFile(link);
  const dbKey = join(link.ctx.dir, 'db.key');
  writeFileSync(dbKey, 'k');
  symlinkSync(dbKey, join(link.ctx.dir, 'files.key'));
  set(link, `BACKUP_REMOTE=${join(link.ctx.dir, 'db-remote')}\nBACKUP_REMOTE_SSH_KEY=${dbKey}\nBACKUP_FILES_REMOTE_SSH_KEY=${join(link.ctx.dir, 'files.key')}\n`);
  const r = link.run(['--files'], { SHIM_RSYNC_LOG: rsyncLog(link) });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /совпадает с ключом БД/);
  assert.equal(link.status('files-status.json').offsite, false);

  // ключ БД читается текущим пользователем (файл существует и открыт): отказ даже при своём ключе файлов
  const open = makeBackupCtx();
  withFile(open);
  const db2 = join(open.ctx.dir, 'db2.key');
  writeFileSync(db2, 'k');
  set(open, `BACKUP_REMOTE=${join(open.ctx.dir, 'db-remote')}\nBACKUP_REMOTE_SSH_KEY=${db2}\nBACKUP_FILES_REMOTE_SSH_KEY=/k/files\n`);
  const r2 = open.run(['--files'], { SHIM_RSYNC_LOG: rsyncLog(open) });
  assert.equal(r2.status, 0, out(r2));
  assert.match(r2.stdout, /ключ БД читается этим пользователем/);
  assert.equal(existsSync(rsyncLog(open)), false);
  assert.equal(open.status('files-status.json').offsite, false);
});

test('backup.sh: статус занят каталогом - строка в журнал, бэкап не падает', opts, () => {
  const b = makeBackupCtx();
  mkdirSync(join(b.ops, 'backup-status.json'));
  const r = b.run();
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /не удалось записать статус backup-status\.json/);
});

test('backup.sh --files: ни одного адреса - второй копии нет, offsite=false', opts, () => {
  const b = makeBackupCtx();
  writeFileSync(join(b.storage, 'f.txt'), 'x');
  const r = b.run(['--files']);
  assert.equal(r.status, 0, out(r));
  assert.equal(b.status('files-status.json').offsite, false);
});

test('backup.sh: статус пишется через mktemp, заранее подложенная ссылка .tmp не трогает цель, права 0644', opts, () => {
  const b = makeBackupCtx();
  const target = join(b.ctx.dir, 'victim.conf');
  writeFileSync(target, 'не менять\n');
  chmodSync(target, 0o600);
  symlinkSync(target, join(b.ops, 'backup-status.json.tmp'));
  const r = b.run();
  assert.equal(r.status, 0, out(r));
  assert.equal(readFileSync(target, 'utf8'), 'не менять\n', 'цель ссылки не перезаписана');
  assert.equal(statSync(target).mode & 0o777, 0o600, 'права цели не менялись');
  assert.equal(statSync(join(b.ops, 'backup-status.json')).mode & 0o777, 0o644);
  assert.equal(b.status().ok, true);
  assert.deepEqual(readdirSync(b.ops).filter((f) => f.startsWith('.status.')), [], 'временных файлов не осталось');
});

test('backup.sh: на месте статуса каталог или ссылка на каталог - цель не тронута, лишних файлов в ней нет', opts, () => {
  for (const kind of ['dir', 'link']) {
    const b = makeBackupCtx();
    const victim = join(b.ctx.dir, `victim-${kind}`);
    mkdirSync(victim);
    const status = join(b.ops, 'backup-status.json');
    if (kind === 'dir') mkdirSync(status);
    else symlinkSync(victim, status);
    const r = b.run();
    assert.equal(r.status, 0, out(r)); // запись статуса не должна ронять бэкап
    assert.deepEqual(readdirSync(kind === 'dir' ? status : victim), [], `${kind}: в целевом каталоге пусто`);
    assert.deepEqual(readdirSync(b.ops).filter((f) => f.startsWith('.status.')), [], 'временных файлов не осталось');
  }
});

test('backup.sh --label: статус ночного бэкапа не перезаписывается', opts, () => {
  const b = makeBackupCtx();
  assert.equal(b.run().status, 0);
  const nightly = readFileSync(join(b.ops, 'backup-status.json'), 'utf8');
  assert.equal(b.run(['--label', 'pre-deploy-x']).status, 0);
  assert.equal(readFileSync(join(b.ops, 'backup-status.json'), 'utf8'), nightly);
  assert.equal(b.status('manual-status.json').ok, true);
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

// --- deploy.sh: группа каталога релиза.

test('deploy.sh: группа релиза совпадает с группой приложения - выкладка проходит', opts, () => {
  const ctx = makeCtx();
  const group = spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim();
  const r = deploy(ctx, 'v0.1.0', { CRP_APP_GROUP: group });
  assert.equal(r.status, 0, out(r));
  assert.equal(releases(ctx).length, 1);
});

test('deploy.sh: чужая группа релиза - код 2, каталог релиза удалён', opts, () => {
  const ctx = makeCtx();
  const r = deploy(ctx, 'v0.1.0', { CRP_APP_GROUP: 'crp-no-such-group' });
  assert.equal(r.status, 2, out(r));
  assert.match(out(r), /группа каталога релиза/);
  assert.deepEqual(releases(ctx), []);
});

// --- Корень установки и уборка (gate5-fixes).

test('switch_current: нет права записи в корень - код 2 и понятная причина в deploy.log', opts, () => {
  const ctx = makeCtx();
  // От root права каталога не действуют: отказ ln даёт заглушка в PATH.
  const bin = join(ctx.dir, 'failbin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ln'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'ln'), 0o755);
  const r = spawnSync('bash', ['-c', `. "${join(BIN, 'lib.sh')}"; switch_current r1; echo после`], {
    env: { ...env(ctx), PATH: `${bin}:${env(ctx).PATH}` },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, out(r));
  assert.doesNotMatch(r.stdout, /после/);
  assert.match(readFileSync(join(ctx.root, 'shared', 'state', 'deploy.log'), 'utf8'), /нет права записи в/);
});

test('deploy.sh: уборка старого релиза не удалась - выкладка всё равно код 0', opts, () => {
  const ctx = makeCtx();
  const realRm = spawnSync('sh', ['-c', 'command -v rm'], { encoding: 'utf8' }).stdout.trim();
  const bin = join(ctx.dir, 'rmbin');
  mkdirSync(bin);
  // rm -rf по каталогу релиза падает, как падает удаление чужих подкаталогов .next/cache
  writeFileSync(join(bin, 'rm'), `#!/bin/sh\ncase "$*" in *-rf*/releases/*) exit 1;; esac\nexec ${realRm} "$@"\n`);
  chmodSync(join(bin, 'rm'), 0o755);
  const extra = { CRP_KEEP_RELEASES: '1', PATH: `${bin}:${env(ctx).PATH}` };
  assert.equal(deploy(ctx, 'v0.1.0', extra).status, 0);
  assert.equal(deploy(ctx, 'v0.2.0', extra).status, 0);
  const r = deploy(ctx, 'v0.3.0', extra);
  assert.equal(r.status, 0, out(r));
  assert.match(readFileSync(join(ctx.root, 'shared', 'state', 'deploy.log'), 'utf8'), /не удалось удалить релиз .*v0\.1\.0/);
  assert.match(currentId(ctx), /v0\.3\.0$/);
  assert.equal(count(ctx, 'health:3000:ok'), 3);
});

function setfaclStub(ctx: Ctx, code: number) {
  const bin = join(ctx.dir, 'aclbin');
  mkdirSync(bin);
  const argsFile = join(ctx.dir, 'setfacl.args');
  writeFileSync(join(bin, 'setfacl'), `#!/bin/sh\necho "$@" >>"${argsFile}"\nexit ${code}\n`);
  chmodSync(join(bin, 'setfacl'), 0o755);
  return { path: `${bin}:${env(ctx).PATH}`, argsFile };
}

test('deploy.sh: default ACL группы приложения ставится на .next/cache релиза', opts, () => {
  const ctx = makeCtx();
  const group = spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim();
  const st = setfaclStub(ctx, 0);
  const r = deploy(ctx, 'v0.1.0', { CRP_APP_GROUP: group, PATH: st.path });
  assert.equal(r.status, 0, out(r));
  const args = readFileSync(st.argsFile, 'utf8').trim();
  assert.match(args, new RegExp(`^-d -m g:${group}:rwX .*/releases/[^ ]+/\\.next/cache$`));
});

test('deploy.sh: setfacl не удался - предупреждение в deploy.log, выкладка код 0', opts, () => {
  const ctx = makeCtx();
  const group = spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim();
  const st = setfaclStub(ctx, 1);
  const r = deploy(ctx, 'v0.1.0', { CRP_APP_GROUP: group, PATH: st.path });
  assert.equal(r.status, 0, out(r));
  assert.match(readFileSync(join(ctx.root, 'shared', 'state', 'deploy.log'), 'utf8'), /setfacl не удался/);
});

// --- healthcheck.sh: curl и pm2 подменены в каталоге теста; запросы curl пишутся в файл.

function makeHealthCtx(opts2: { remote?: boolean; offsite?: boolean; filesOffsite?: boolean; filesAt?: number; emptyStorage?: boolean; since?: number; tg?: boolean } = {}) {
  const ctx = makeCtx();
  const ops = join(ctx.dir, 'ops');
  const shims = join(ctx.dir, 'hshims');
  mkdirSync(ops, { recursive: true });
  mkdirSync(shims, { recursive: true });
  const calls = join(ctx.dir, 'curl-calls.txt');
  writeFileSync(calls, '');
  writeFileSync(
    join(shims, 'curl'),
    `#!/usr/bin/env bash
for a in "$@"; do [[ "$a" == http* ]] && url="$a"; done
if [[ "$url" == http://127.0.0.1:* ]]; then echo '{"status":"ok"}'; exit 0; fi
{ echo "ARGV: $*"; echo "STDIN: $(cat)"; } >>"${calls}"
`,
  );
  writeFileSync(join(shims, 'pm2'), `#!/usr/bin/env bash\necho '[{"name":"crp","pm2_env":{"status":"online","restart_time":0}}]'\n`);
  chmodSync(join(shims, 'curl'), 0o755);
  chmodSync(join(shims, 'pm2'), 0o755);
  const now = Date.now();
  const st = (offsite: boolean, at = now) => JSON.stringify({ ok: true, at, file: 'x', sizeBytes: 1, verified: false, offsite });
  writeFileSync(join(ops, 'backup-status.json'), st(opts2.offsite ?? true));
  const storage = join(ctx.dir, 'storage');
  mkdirSync(storage, { recursive: true });
  if (!opts2.emptyStorage) writeFileSync(join(storage, 'f'), 'x');
  writeFileSync(join(ops, 'files-status.json'), st(opts2.filesOffsite ?? true, opts2.filesAt ?? now));
  if (opts2.since) {
    writeFileSync(join(ops, 'monitor-state.json'), JSON.stringify({ at: now, checks: {}, offsiteSince: opts2.since }));
  }
  writeFileSync(join(ctx.dir, 'backup.env'), opts2.remote ? 'BACKUP_REMOTE=store@example.invalid:/b\n' : '');
  writeFileSync(join(ctx.dir, 'app.env'), `STORAGE_DIR=${storage}\n`);
  writeFileSync(join(ctx.dir, 'monitor.env'), opts2.tg ? 'ALERT_TELEGRAM_BOT_TOKEN=SECRETTOKEN123\nALERT_TELEGRAM_CHAT_ID=42\n' : '');
  const run = () =>
    spawnSync('bash', [join(BIN, 'healthcheck.sh')], {
      env: {
        ...env(ctx),
        PATH: `${shims}:${process.env.PATH ?? ''}`,
        CRP_OPS_DIR: ops,
        CRP_BACKUP_ENV: join(ctx.dir, 'backup.env'),
        CRP_APP_ENV: join(ctx.dir, 'app.env'),
        CRP_MONITOR_ENV: join(ctx.dir, 'monitor.env'),
        CRP_HEALTH_PM2: 'pm2',
      } as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });
  const state = () => JSON.parse(readFileSync(join(ops, 'monitor-state.json'), 'utf8'));
  return { run, state, dir: ctx.dir, ops, calls: () => readFileSync(calls, 'utf8') };
}

test('healthcheck.sh: offsite=false при заданном BACKUP_REMOTE - warn, без алерта в первые сутки', opts, () => {
  const h = makeHealthCtx({ remote: true, offsite: false, tg: true });
  const r = h.run();
  assert.equal(r.status, 0, out(r));
  assert.equal(h.state().checks.backup_offsite, 'warn');
  assert.equal(h.calls(), '');
});

test('healthcheck.sh: offsite=false дольше 48 часов - fail и алерт, токен не в argv curl', opts, () => {
  const h = makeHealthCtx({ remote: true, offsite: false, tg: true, since: Math.floor(Date.now() / 1000) - 49 * 3600 });
  const r = h.run();
  assert.equal(r.status, 0, out(r));
  assert.equal(h.state().checks.backup_offsite, 'fail');
  const calls = h.calls();
  assert.match(calls, /backup_offsite/);
  assert.doesNotMatch((calls.split('STDIN:')[0] ?? ''), /SECRETTOKEN123/, 'токен не должен быть в аргументах');
  assert.match(calls, /STDIN: url = ".*SECRETTOKEN123/);
});

test('healthcheck.sh: offsite=false в files-status.json тоже учитывается; без BACKUP_REMOTE проверки нет', opts, () => {
  const a = makeHealthCtx({ remote: true, filesOffsite: false });
  assert.equal(a.run().status, 0);
  assert.equal(a.state().checks.backup_offsite, 'warn');
  const b = makeHealthCtx({ remote: false, offsite: false });
  assert.equal(b.run().status, 0);
  assert.equal(b.state().checks.backup_offsite, undefined);
});

test('healthcheck.sh: пустое хранилище и старый files-status.json с offsite=false - backup_offsite не warn', opts, () => {
  const old = Date.now() - 100 * 3600 * 1000;
  const h = makeHealthCtx({ remote: true, emptyStorage: true, filesOffsite: false, filesAt: old });
  assert.equal(h.run().status, 0);
  assert.equal(h.state().checks.backup_offsite, 'ok');
  assert.equal(h.state().checks.backup_files, undefined, 'при пустом хранилище проверки файлов нет');
  // тот же статус, но свежий, при пустом хранилище тоже не учитывается
  const fresh = makeHealthCtx({ remote: true, emptyStorage: true, filesOffsite: false });
  assert.equal(fresh.run().status, 0);
  assert.equal(fresh.state().checks.backup_offsite, 'ok');
});

test('healthcheck.sh: files-status.json старше 26 часов не включает backup_offsite (его уже ловит backup_files)', opts, () => {
  const h = makeHealthCtx({ remote: true, filesOffsite: false, filesAt: Date.now() - 27 * 3600 * 1000 });
  assert.equal(h.run().status, 0);
  assert.equal(h.state().checks.backup_offsite, 'ok');
  assert.equal(h.state().checks.backup_files, 'fail');
});

test('healthcheck.sh: адрес копии файлов задан только в BACKUP_FILES_REMOTE - offsite=false файлов учитывается', opts, () => {
  const h = makeHealthCtx({ remote: false, filesOffsite: false });
  writeFileSync(join(h.dir, 'backup.env'), 'BACKUP_FILES_REMOTE=store@example.invalid:/f\n');
  assert.equal(h.run().status, 0);
  assert.equal(h.state().checks.backup_offsite, 'warn');
});

test('healthcheck.sh: monitor-state.json пишется без предсказуемого .tmp, права 0644, ссылка не трогает цель', opts, () => {
  const h = makeHealthCtx({ remote: true });
  const target = join(h.dir, 'victim.conf');
  writeFileSync(target, 'не менять\n');
  symlinkSync(target, join(h.ops, 'monitor-state.json.tmp'));
  assert.equal(h.run().status, 0);
  assert.equal(readFileSync(target, 'utf8'), 'не менять\n');
  assert.equal(statSync(join(h.ops, 'monitor-state.json')).mode & 0o777, 0o644);
  assert.deepEqual(readdirSync(h.ops).filter((f) => f.startsWith('.state.')), []);
});

// --- restore.sh: порт проверки «приложение остановлено» берётся из instance.json.

test('restore.sh --force-prod: порт проверки из shared/instance.json, а не 3000', opts, () => {
  const ctx = makeCtx();
  writeFileSync(join(ctx.root, 'shared', 'instance.json'), JSON.stringify({ name: 'crp', port: 3456 }));
  const shims = join(ctx.dir, 'rshims');
  mkdirSync(shims, { recursive: true });
  const calls = join(ctx.dir, 'curl-urls.txt');
  writeFileSync(join(shims, 'curl'), `#!/usr/bin/env bash\nfor a in "$@"; do [[ "$a" == http* ]] && echo "$a" >>"${calls}"; done\nexit 0\n`);
  chmodSync(join(shims, 'curl'), 0o755);
  const dump = join(ctx.dir, 'x.dump');
  writeFileSync(dump, 'x');
  writeFileSync(join(ctx.dir, 'backup.env'), 'BACKUP_DB=crp\n');
  const r = spawnSync('bash', [join(BIN, 'restore.sh'), '--file', dump, '--target', 'crp', '--force-prod'], {
    env: { ...env(ctx), PATH: `${shims}:${process.env.PATH ?? ''}`, CRP_BACKUP_ENV: join(ctx.dir, 'backup.env') } as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /порту 3456/);
  assert.match(readFileSync(calls, 'utf8'), /127\.0\.0\.1:3456\/api\/health/);
});

// --- install-ops.sh: от root ничего не делается по ссылкам под корнем, порт из instance.json — только число.

function installOpsDry(root: string) {
  return spawnSync('bash', [join(BIN, 'install-ops.sh'), '--dry-run', '--domain', 'x.kz', '--root', root], { encoding: 'utf8' });
}

test('install-ops.sh --dry-run: releases — ссылка, отказ с кодом 2 до любых действий', opts, () => {
  const dir = mkdtempSync(join(tmpdir(), 'crp-install-'));
  temps.push(dir);
  const root = join(dir, 'srv');
  mkdirSync(join(root, 'shared'), { recursive: true });
  mkdirSync(join(dir, 'elsewhere'));
  symlinkSync(join(dir, 'elsewhere'), join(root, 'releases'));
  const r = installOpsDry(root);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /символическая ссылка/);
  assert.doesNotMatch(r.stdout, /^\+ /m, 'до проверки ссылок ничего не выполняется');
});

test('install-ops.sh --dry-run: port в instance.json не число — отказ с кодом 2', opts, () => {
  const dir = mkdtempSync(join(tmpdir(), 'crp-install-'));
  temps.push(dir);
  const root = join(dir, 'srv');
  mkdirSync(join(root, 'shared'), { recursive: true });
  writeFileSync(join(root, 'shared', 'instance.json'), JSON.stringify({ name: 'crp', port: '3000;x' }));
  const r = installOpsDry(root);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /недопустимый port/);
});

test('install-ops.sh --dry-run: обычная раскладка проходит, под корнем всё от crpdeploy', opts, () => {
  const dir = mkdtempSync(join(tmpdir(), 'crp-install-'));
  temps.push(dir);
  const root = join(dir, 'srv');
  mkdirSync(root);
  const r = installOpsDry(root);
  assert.equal(r.status, 0, out(r));
  // «+ write» и «+ render» — пометки пробного прогона, а не команды (настоящая запись instance.json — тоже от crpdeploy).
  const underRoot = r.stdout.split('\n').filter((l) => l.startsWith('+ ') && !/^\+ (write|render) /.test(l) && l.includes(`${root}/`));
  assert.ok(underRoot.length > 0, out(r));
  for (const l of underRoot) assert.match(l, /^\+ runuser -u crpdeploy -- /, l);
});

// --- previous пишется только после успешного switch_current (ops-polish).

/** Каталог с оберткой mv: при наличии флага-файла и ключа -T падает, иначе передаёт настоящему mv (так ломается switch_current). */
function failingMvPath(ctx: Ctx) {
  const bin = join(ctx.dir, 'failmv');
  mkdirSync(bin);
  const real = spawnSync('sh', ['-c', 'command -v mv'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'mv'), `#!/usr/bin/env bash\nfor a in "$@"; do if [[ "$a" == -T && -e "$FAIL_MV_FLAG" ]]; then exit 1; fi; done\nexec ${real} "$@"\n`);
  chmodSync(join(bin, 'mv'), 0o755);
  return { path: `${bin}:${env(ctx).PATH}`, flag: join(ctx.dir, 'fail-mv-flag') };
}

test('rollback.sh: сбой switch_current не меняет previous и current', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  assert.equal(deploy(ctx, 'v0.2.0').status, 0);
  const prevFile = join(ctx.root, 'shared', 'state', 'previous');
  const before = readFileSync(prevFile, 'utf8');
  const curBefore = currentId(ctx);
  const { path, flag } = failingMvPath(ctx);
  writeFileSync(flag, '');
  const r = spawnSync('bash', [join(BIN, 'rollback.sh')], { env: env(ctx, { PATH: path, FAIL_MV_FLAG: flag }), encoding: 'utf8' });
  assert.equal(r.status, 2, out(r));
  assert.equal(readFileSync(prevFile, 'utf8'), before, 'previous не тронут');
  assert.equal(currentId(ctx), curBefore);
  // Следующий откат (mv снова работает) идёт на тот же релиз, а не отвечает «уже текущий».
  rmSync(flag);
  const again = rollback(ctx);
  assert.equal(again.status, 0, out(again));
  assert.equal(currentId(ctx), before.trim());
});

test('deploy.sh: сбой switch_current не меняет previous', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  assert.equal(deploy(ctx, 'v0.2.0').status, 0);
  const prevFile = join(ctx.root, 'shared', 'state', 'previous');
  const before = readFileSync(prevFile, 'utf8');
  const curBefore = currentId(ctx);
  const { path, flag } = failingMvPath(ctx);
  writeFileSync(flag, '');
  const r = deploy(ctx, 'v0.3.0', { PATH: path, FAIL_MV_FLAG: flag });
  assert.equal(r.status, 2, out(r));
  assert.equal(readFileSync(prevFile, 'utf8'), before, 'previous не тронут');
  assert.equal(currentId(ctx), curBefore);
});

test('deploy.sh: сбой записи previous после переключения не удаляет релиз и не даёт код 2', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  assert.equal(deploy(ctx, 'v0.2.0').status, 0);
  mkdirSync(join(ctx.root, 'shared', 'state', 'previous.tmp'));
  const r = deploy(ctx, 'v0.3.0');
  assert.notEqual(r.status, 2, out(r));
  assert.ok(existsSync(join(ctx.root, 'current', 'RELEASE.json')), 'current разрешается в существующий релиз');
  assert.ok(releases(ctx).includes(currentId(ctx)));
});

test('rollback.sh: сбой записи previous после переключения не обрывает перезагрузку', opts, () => {
  const ctx = makeCtx();
  assert.equal(deploy(ctx, 'v0.1.0').status, 0);
  assert.equal(deploy(ctx, 'v0.2.0').status, 0);
  const reloads = count(ctx, 'reload');
  mkdirSync(join(ctx.root, 'shared', 'state', 'previous.tmp'));
  const r = rollback(ctx);
  assert.equal(r.status, 0, out(r));
  assert.ok(existsSync(join(ctx.root, 'current', 'RELEASE.json')));
  assert.equal(count(ctx, 'reload'), reloads + 1, 'reload после отката вызван');
});

// --- install-ops.sh: диапазон порта.

test('install-ops.sh --dry-run: порт вне 1-65535 или с ведущим нулём отклоняется (--port и instance.json)', opts, () => {
  for (const bad of ['70000', '00080', '0', '65536', '3000;x']) {
    const dir = mkdtempSync(join(tmpdir(), 'crp-install-'));
    temps.push(dir);
    const root = join(dir, 'srv');
    mkdirSync(join(root, 'shared'), { recursive: true });
    const viaArg = spawnSync('bash', [join(BIN, 'install-ops.sh'), '--dry-run', '--domain', 'x.kz', '--root', root, '--port', bad], { encoding: 'utf8' });
    assert.equal(viaArg.status, 2, `--port ${bad}: ${out(viaArg)}`);
    assert.match(viaArg.stderr, /недопустимый --port/);
    writeFileSync(join(root, 'shared', 'instance.json'), JSON.stringify({ name: 'crp', port: bad }));
    const viaFile = installOpsDry(root);
    assert.equal(viaFile.status, 2, `instance.json ${bad}: ${out(viaFile)}`);
    assert.match(viaFile.stderr, /недопустимый port/);
  }
  for (const good of ['1', '80', '3000', '65535']) {
    const dir = mkdtempSync(join(tmpdir(), 'crp-install-'));
    temps.push(dir);
    const root = join(dir, 'srv');
    mkdirSync(root);
    const r = spawnSync('bash', [join(BIN, 'install-ops.sh'), '--dry-run', '--domain', 'x.kz', '--root', root, '--port', good], { encoding: 'utf8' });
    assert.equal(r.status, 0, `--port ${good}: ${out(r)}`);
  }
});
