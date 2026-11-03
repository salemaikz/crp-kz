// tools/release/server-import.sh (D-042): импорт очищенного снимка коммита в bare-репозиторий сервера.
// Без сети: CRP_SRC_TARBALL подменяет скачивание архива (проверки ветки и CI GitHub тогда не выполняются,
// если не задан CRP_GH_API; с ним они идут против локальной заглушки API),
// CRP_SRC_REPO указывает на временный репозиторий. Архивы собираются из git archive этого репозитория;
// «плохие» варианты - распаковка, правка, упаковка заново. Без bash, git и tar тесты пропускаются.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const SCRIPT = join(ROOT, 'tools', 'release', 'server-import.sh');

const haveTools = process.platform !== 'win32' && spawnSync('sh', ['-c', 'command -v bash git tar gzip'], { stdio: 'ignore' }).status === 0;
const opts = { skip: haveTools ? false : 'нужны bash, git, tar (на этой машине их нет)' };

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const TOP = (sha: string) => `crp-kz-${sha}`;
const TRACE_RE = /local TRACE_RE='([^']*)'/.exec(readFileSync(SCRIPT, 'utf8'))?.[1] ?? '';

const work = mkdtempSync(join(tmpdir(), 'crp-srvimport-'));
after(() => rmSync(work, { recursive: true, force: true }));

let seq = 0;
const fresh = (name: string) => {
  const d = join(work, `${name}-${++seq}`);
  mkdirSync(d, { recursive: true });
  return d;
};

const cleanEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ PATH: process.env.PATH ?? '', HOME: work, LC_ALL: 'C.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra }) as unknown as NodeJS.ProcessEnv;

/** Архив рабочего дерева (tracked-файлы, включая незакоммиченные правки), а если правок нет - HEAD. */
let baseTgz = '';
before(() => {
  if (!haveTools) return;
  const id = { GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@localhost', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@localhost' };
  const stash = spawnSync('git', ['stash', 'create'], { cwd: ROOT, env: cleanEnv(id), encoding: 'utf8' });
  const ref = stash.status === 0 && stash.stdout.trim() ? stash.stdout.trim() : 'HEAD';
  baseTgz = join(fresh('base'), 'base.tgz');
  const r = spawnSync('sh', ['-c', `git archive --prefix=${TOP(SHA)}/ ${ref} | gzip > "${baseTgz}"`], { cwd: ROOT, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

/** Копия базового архива с правкой: распаковать, изменить содержимое каталога верхнего уровня, упаковать. */
function variant(mutate: (top: string) => void): string {
  const dir = fresh('var');
  const x = spawnSync('tar', ['-xzf', baseTgz, '-C', dir], { encoding: 'utf8' });
  assert.equal(x.status, 0, x.stderr);
  const top = join(dir, TOP(SHA));
  mutate(top);
  const out = join(dir, 'out.tgz');
  const p = spawnSync('tar', ['-czf', out, '-C', dir, TOP(SHA)], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return out;
}

function put(top: string, rel: string, text: string) {
  const p = join(top, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

type Run = SpawnSyncReturns<string>;
const out = (r: Run) => `${r.stdout}\n${r.stderr}`;

function makeRepoPath() {
  return join(fresh('srv'), 'repo.git');
}

function runImport(repo: string, tgz: string, args: string[], extraEnv: Record<string, string> = {}): Run {
  return spawnSync('bash', [SCRIPT, ...args], {
    env: cleanEnv({ CRP_SRC_TARBALL: tgz, CRP_SRC_REPO: repo, ...extraEnv }),
    encoding: 'utf8',
  });
}

function git(repo: string, ...args: string[]): Run {
  return spawnSync('git', ['--git-dir', repo, ...args], { env: cleanEnv(), encoding: 'utf8' });
}
const gitOut = (repo: string, ...args: string[]) => String(git(repo, ...args).stdout).trim();
const files = (repo: string) => gitOut(repo, 'ls-tree', '-r', '--name-only', 'main').split('\n');

test('скрипт: TRACE_RE найден, bash -n проходит', opts, () => {
  assert.ok(TRACE_RE.length > 20, 'не удалось выделить TRACE_RE из скрипта');
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('первый импорт: ветка main и тег, нейтральный автор, source в теле, родителя нет', opts, () => {
  const repo = makeRepoPath();
  const r = runImport(repo, baseTgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 0, out(r));
  const main = gitOut(repo, 'rev-parse', 'refs/heads/main');
  assert.match(main, /^[0-9a-f]{40}$/);
  assert.equal(gitOut(repo, 'rev-parse', 'refs/tags/v0.1.0^{commit}'), main);
  assert.equal(gitOut(repo, 'log', '-1', '--format=%an <%ae>', 'main'), 'release <release@localhost>');
  assert.equal(gitOut(repo, 'log', '-1', '--format=%cn <%ce>', 'main'), 'release <release@localhost>');
  assert.match(gitOut(repo, 'log', '-1', '--format=%B', 'main'), new RegExp(`^release v0\\.1\\.0\\n\\nsource ${SHA}$`));
  assert.equal(gitOut(repo, 'log', '-1', '--format=%P', 'main'), '', 'у первого коммита нет родителя');
  assert.equal(gitOut(repo, 'rev-list', '--count', 'main'), '1');
});

test('второй импорт с новым тегом: родитель - предыдущий коммит main', opts, () => {
  const repo = makeRepoPath();
  assert.equal(runImport(repo, baseTgz, [SHA, 'v0.1.0']).status, 0);
  const first = gitOut(repo, 'rev-parse', 'main');
  const r = runImport(repo, baseTgz, [SHA2, 'v0.2.0']);
  assert.equal(r.status, 0, out(r));
  assert.equal(gitOut(repo, 'log', '-1', '--format=%P', 'main'), first);
  assert.equal(gitOut(repo, 'rev-list', '--count', 'main'), '2');
  assert.match(gitOut(repo, 'log', '-1', '--format=%B', 'main'), new RegExp(`source ${SHA2}$`));
  assert.equal(gitOut(repo, 'rev-parse', 'refs/tags/v0.1.0^{commit}'), first, 'старый тег на месте');
  assert.equal(gitOut(repo, 'rev-parse', 'refs/tags/v0.2.0^{commit}'), gitOut(repo, 'rev-parse', 'main'));
});

test('повторный тег: код 2, main и теги не изменились', opts, () => {
  const repo = makeRepoPath();
  assert.equal(runImport(repo, baseTgz, [SHA, 'v0.1.0']).status, 0);
  const before = gitOut(repo, 'show-ref');
  const r = runImport(repo, baseTgz, [SHA2, 'v0.1.0']);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /уже есть/);
  assert.equal(gitOut(repo, 'show-ref'), before);
});

test('снимок: файлы для работы на месте, служебных нет, deploy.sh исполняемый', opts, () => {
  const repo = makeRepoPath();
  const r = runImport(repo, baseTgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 0, out(r));
  const list = files(repo);
  const has = (p: string) => list.includes(p);
  assert.ok(has('docs/brand/logo/crp-logo.png'), 'логотип');
  assert.ok(list.some((p) => /^assets\/fonts\/pdf\/.+\.ttf$/.test(p)), 'шрифты PDF');
  assert.ok(list.some((p) => p.startsWith('content/legal/')), 'юридические тексты');
  for (const p of ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs']) assert.ok(has(p), p);
  assert.match(gitOut(repo, 'ls-tree', 'main', 'deploy/bin/deploy.sh'), /^100755 blob [0-9a-f]{40}\tdeploy\/bin\/deploy\.sh$/);
  for (const bad of ['CLAUDE.md', 'AGENTS.md', '.claude', 'docs/agents', 'docs/handoffs', 'tests', 'tools']) {
    assert.equal(list.some((p) => p === bad || p.startsWith(`${bad}/`)), false, `${bad} не должен попасть на сервер`);
  }
  // из docs/ выгружен только логотип
  assert.deepEqual(list.filter((p) => p.startsWith('docs/')), ['docs/brand/logo/crp-logo.png']);
});

test('снимок: нет совпадений с регэкспом следов разработки', opts, () => {
  const repo = makeRepoPath();
  assert.equal(runImport(repo, baseTgz, [SHA, 'v0.1.0']).status, 0);
  const g = git(repo, 'grep', '-i', '-I', '-E', TRACE_RE, 'main');
  assert.equal(g.status, 1, `найдены следы:\n${String(g.stdout).split('\n').slice(0, 10).join('\n')}`);
});

test('замена пометок: файл с пробелом в имени обрабатывается', opts, () => {
  const repo = makeRepoPath();
  const tgz = variant((top) => put(top, 'src/a b.css', '/* без ИИ-шума */\n.a { color: red; }\n'));
  const r = runImport(repo, tgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 0, out(r));
  const text = String(git(repo, 'show', 'main:src/a b.css').stdout);
  assert.match(text, /без визуального шума/);
  assert.doesNotMatch(text, /ИИ-шум/);
});

test('замена пометок: «(страницы перепишут агенты фич)» убирается', opts, () => {
  const repo = makeRepoPath();
  const tgz = variant((top) => put(top, 'src/note.ts', '// заглушка (страницы перепишут агенты фич)\n'));
  const r = runImport(repo, tgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 0, out(r));
  assert.equal(String(git(repo, 'show', 'main:src/note.ts').stdout), '// заглушка\n');
});

test('находка следа: код 2, репозиторий не создаётся', opts, () => {
  const repo = makeRepoPath();
  const tgz = variant((top) => put(top, 'src/leak.ts', '// сгенерировано Claude\n'));
  const r = runImport(repo, tgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /служебные пометки/);
  assert.equal(existsSync(repo), false);
});

test('находка следа: существующий репозиторий не меняется', opts, () => {
  const repo = makeRepoPath();
  assert.equal(runImport(repo, baseTgz, [SHA, 'v0.1.0']).status, 0);
  const before = gitOut(repo, 'show-ref');
  const tgz = variant((top) => put(top, 'src/leak.ts', '// handoff\n'));
  const r = runImport(repo, tgz, [SHA2, 'v0.2.0']);
  assert.equal(r.status, 2, out(r));
  assert.equal(gitOut(repo, 'show-ref'), before);
});

test('находка следа среди 1500 строк: код 2, импорта нет (регрессия: SIGPIPE от head)', opts, () => {
  const repo = makeRepoPath();
  const big = Array.from({ length: 1500 }, (_, i) => `// claude ${i}`).join('\n') + '\n';
  const tgz = variant((top) => {
    put(top, 'src/big.ts', big);
    put(top, 'src/big2.ts', big);
  });
  const r = runImport(repo, tgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 2, out(r));
  assert.equal(existsSync(repo), false);
  // в вывод попадает не больше 20 строк находок
  assert.ok(r.stderr.split('\n').filter((l) => l.includes('claude')).length <= 20);
});

test('след в имени файла: код 2, репозиторий не создаётся', opts, () => {
  const repo = makeRepoPath();
  const tgz = variant((top) => put(top, 'src/x.claude.txt', 'ok\n'));
  const r = runImport(repo, tgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /служебные файлы/);
  assert.equal(existsSync(repo), false);
});

test('нет пути из списка выгрузки (content/): код 2, репозиторий не создаётся', opts, () => {
  const repo = makeRepoPath();
  const tgz = variant((top) => rmSync(join(top, 'content'), { recursive: true, force: true }));
  const r = runImport(repo, tgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 2, out(r));
  assert.equal(existsSync(repo), false);
});

test('локаль C у оператора не мешает: «Оркестратор» с заглавной ловится', opts, () => {
  const repo = makeRepoPath();
  const tgz = variant((top) => put(top, 'src/note.ts', '// Оркестратор раздал задачи\n'));
  const r = runImport(repo, tgz, [SHA, 'v0.1.0'], { LC_ALL: 'C', LANG: 'C' });
  assert.equal(r.status, 2, out(r));
  assert.equal(existsSync(repo), false);
  // и чистый снимок в той же локали импортируется
  const ok = runImport(repo, baseTgz, [SHA, 'v0.1.0'], { LC_ALL: 'C', LANG: 'C' });
  assert.equal(ok.status, 0, out(ok));
});

test('неверные аргументы: код 2, репозиторий не создаётся', opts, () => {
  const cases: string[][] = [
    ['abc123', 'v0.1.0'], // короткий sha
    [SHA.toUpperCase(), 'v0.1.0'], // sha только строчными
    [SHA, '0.1.0'], // тег без v
    [SHA, 'v1.0'], // не vX.Y.Z
    [SHA, 'v1.0.0; rm -rf /'],
    [SHA], // нет тега
    [],
    [SHA, 'v0.1.0', '--unknown'], // неизвестный флаг
    [SHA, 'v0.1.0', 'extra'], // лишний аргумент
    [SHA, 'v0.1.0', '--branch'], // нет значения
    [SHA, 'v0.1.0', '--branch', 'bad branch;x'], // недопустимое имя ветки
  ];
  for (const args of cases) {
    const repo = makeRepoPath();
    const r = runImport(repo, baseTgz, args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${out(r)}`);
    assert.equal(existsSync(repo), false, JSON.stringify(args));
  }
});

test('путь репозитория существует, но это не bare-репозиторий: код 2', opts, () => {
  const repo = makeRepoPath();
  mkdirSync(repo, { recursive: true });
  const r = runImport(repo, baseTgz, [SHA, 'v0.1.0']);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /не bare/);
});

// ---- Проверки ветки и CI против заглушки API GitHub (CRP_GH_API) ----

const REPO_PATH = '/repos/salemaikz/crp-kz';
const CI_NAME = 'Проверки и e2e';

interface Reply { code: number; body: unknown }
interface Stub {
  defaultBranch: string;
  branchPages: string[][];
  /** Ответ сравнения по имени ветки; нет записи - 404. */
  compare: Record<string, Reply>;
  checks: Reply;
}

const cmp = (status: string): Reply => ({ code: 200, body: { status } });
const greenCi = (): Reply => ({ code: 200, body: { check_runs: [{ name: CI_NAME, conclusion: 'success' }] } });

function newStub(over: Partial<Stub> = {}): Stub {
  return { defaultBranch: 'main', branchPages: [], compare: {}, checks: greenCi(), ...over };
}

/** Запускает заглушку в этом процессе; log - журнал путей запросов. */
async function withStub<T>(stub: Stub, fn: (api: string, log: string[]) => Promise<T>): Promise<T> {
  const log: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '';
    log.push(url);
    const send = (r: Reply) => {
      res.writeHead(r.code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    };
    const path = url.split('?')[0] ?? '';
    if (path === REPO_PATH) return send({ code: 200, body: { default_branch: stub.defaultBranch } });
    if (path === `${REPO_PATH}/branches`) {
      const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
      return send({ code: 200, body: (stub.branchPages[page - 1] ?? []).map((name) => ({ name })) });
    }
    const m = new RegExp(`^${REPO_PATH}/compare/${SHA}\\.\\.\\.(.+)$`).exec(path);
    if (m) return send(stub.compare[decodeURIComponent(m[1] ?? '')] ?? { code: 404, body: { message: 'Not Found' } });
    if (path === `${REPO_PATH}/commits/${SHA}/check-runs`) return send(stub.checks);
    send({ code: 404, body: { message: 'Not Found' } });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    return await fn(`http://127.0.0.1:${addr.port}`, log);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}

interface AsyncRun { status: number | null; stdout: string; stderr: string }

/** Асинхронный запуск: event loop свободен, заглушка отвечает. */
function runImportAsync(repo: string, args: string[], api: string): Promise<AsyncRun> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, ...args], {
      env: cleanEnv({ CRP_SRC_TARBALL: baseTgz, CRP_SRC_REPO: repo, CRP_GH_API: api }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

const cmpLog = (log: string[]) => log.filter((u) => u.includes('/compare/')).map((u) => u.split('...')[1]);

async function scenario(stub: Stub, args: string[]) {
  const repo = makeRepoPath();
  return withStub(stub, async (api, log) => {
    const r = await runImportAsync(repo, [SHA, 'v0.1.0', ...args], api);
    return { r, log, repo, all: `${r.stdout}\n${r.stderr}` };
  });
}

for (const status of ['identical', 'ahead']) {
  test(`ветка: по умолчанию, статус ${status} - импорт, запрашивается только ветка по умолчанию`, opts, async () => {
    const { r, log, repo, all } = await scenario(newStub({ compare: { main: cmp(status) }, branchPages: [['main', 'dev']] }), []);
    assert.equal(r.status, 0, all);
    assert.match(r.stdout, /входит в ветку main/);
    assert.deepEqual(cmpLog(log), ['main']);
    assert.equal(log.some((u) => u.includes('/branches')), false);
    assert.ok(existsSync(repo));
  });
}

for (const status of ['behind', 'diverged']) {
  test(`ветка: по умолчанию, статус ${status} - код 2, другие ветки не запрашиваются, репозитория нет`, opts, async () => {
    const { r, log, repo, all } = await scenario(newStub({ compare: { main: cmp(status), dev: cmp('identical') }, branchPages: [['main', 'dev']] }), []);
    assert.equal(r.status, 2, all);
    assert.match(r.stderr, /не входит/);
    assert.deepEqual(cmpLog(log), ['main']);
    assert.equal(existsSync(repo), false);
  });
}

test('--branch x: сравнивается только x, ветка по умолчанию не запрашивается', opts, async () => {
  const { r, log, all } = await scenario(newStub({ compare: { x: cmp('ahead'), main: cmp('identical') } }), ['--branch', 'x']);
  assert.equal(r.status, 0, all);
  assert.deepEqual(cmpLog(log), ['x']);
  assert.equal(log.includes(REPO_PATH), false);
});

test('--any-branch: коммит найден на второй странице списка веток (пагинация)', opts, async () => {
  const first = Array.from({ length: 100 }, (_, i) => `b${i}`);
  const stub = newStub({ branchPages: [['main', ...first.slice(1)], ['target']], compare: { main: cmp('behind'), target: cmp('ahead') } });
  for (const b of first.slice(1)) stub.compare[b] = cmp('diverged');
  const { r, log, all } = await scenario(stub, ['--any-branch']);
  assert.equal(r.status, 0, all);
  assert.match(r.stdout, /входит в ветку target/);
  assert.ok(log.some((u) => u.includes('page=2')), 'запрошена вторая страница');
  assert.equal(cmpLog(log)[0], 'main', 'ветка по умолчанию первая');
});

test('--any-branch: 404 на сравнении с одной веткой пропускается, поиск идёт дальше', opts, async () => {
  const { r, log, all } = await scenario(newStub({ branchPages: [['main', 'broken', 'good']], compare: { main: cmp('behind'), good: cmp('identical') } }), ['--any-branch']);
  assert.equal(r.status, 0, all);
  assert.match(r.stderr, /пропуск/);
  assert.deepEqual(cmpLog(log), ['main', 'broken', 'good']);
});

test('--any-branch: 403 на сравнении - код 2 и сообщение про лимит, поиск обрывается', opts, async () => {
  const { r, log, repo, all } = await scenario(
    newStub({ branchPages: [['main', 'limited', 'good']], compare: { main: cmp('behind'), limited: { code: 403, body: {} }, good: cmp('identical') } }),
    ['--any-branch'],
  );
  assert.equal(r.status, 2, all);
  assert.match(r.stderr, /лимит/);
  assert.deepEqual(cmpLog(log), ['main', 'limited']);
  assert.equal(existsSync(repo), false);
});

test('--any-branch: коммит ни в одной ветке - код 2, репозитория нет', opts, async () => {
  const { r, repo, all } = await scenario(newStub({ branchPages: [['main', 'dev']], compare: { main: cmp('behind'), dev: cmp('diverged') } }), ['--any-branch']);
  assert.equal(r.status, 2, all);
  assert.match(r.stderr, /не входит/);
  assert.equal(existsSync(repo), false);
});

test('--branch вместе с --any-branch: код 2, к API не обращается', opts, async () => {
  const { r, log, repo, all } = await scenario(newStub(), ['--branch', 'x', '--any-branch']);
  assert.equal(r.status, 2, all);
  assert.equal(log.length, 0);
  assert.equal(existsSync(repo), false);
});

test('CI: зелёный check-run «Проверки и e2e» - импорт', opts, async () => {
  const { r, log, all } = await scenario(newStub({ compare: { main: cmp('identical') } }), []);
  assert.equal(r.status, 0, all);
  assert.ok(log.some((u) => u.includes('/check-runs')));
});

test('CI: нужного check-run нет, не success или чужое имя - код 2, репозитория нет', opts, async () => {
  const bad: Reply[] = [
    { code: 200, body: { check_runs: [] } },
    { code: 200, body: { check_runs: [{ name: CI_NAME, conclusion: 'failure' }] } },
    { code: 200, body: { check_runs: [{ name: CI_NAME, conclusion: null }] } },
    { code: 200, body: { check_runs: [{ name: 'Другая проверка', conclusion: 'success' }] } },
    { code: 500, body: {} },
  ];
  for (const checks of bad) {
    const { r, repo, all } = await scenario(newStub({ compare: { main: cmp('identical') }, checks }), []);
    assert.equal(r.status, 2, `${JSON.stringify(checks)}: ${all}`);
    assert.equal(existsSync(repo), false, JSON.stringify(checks));
  }
});

test('CI: --skip-ci-check не запрашивает check-runs и импортирует при красном CI', opts, async () => {
  const { r, log, all } = await scenario(newStub({ compare: { main: cmp('ahead') }, checks: { code: 200, body: { check_runs: [] } } }), ['--skip-ci-check']);
  assert.equal(r.status, 0, all);
  assert.match(r.stderr, /пропущена/);
  assert.equal(log.some((u) => u.includes('/check-runs')), false);
});

test('CI не проверяется, если ветка не подошла', opts, async () => {
  const { r, log } = await scenario(newStub({ compare: { main: cmp('diverged') } }), []);
  assert.equal(r.status, 2);
  assert.equal(log.some((u) => u.includes('/check-runs')), false);
});
