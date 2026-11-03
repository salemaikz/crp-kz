// tools/release/server-import.sh (D-042): импорт очищенного снимка коммита в bare-репозиторий сервера.
// Без сети: CRP_SRC_TARBALL подменяет скачивание архива (проверки ветки и CI GitHub тогда не выполняются),
// CRP_SRC_REPO указывает на временный репозиторий. Архивы собираются из git archive этого репозитория;
// «плохие» варианты - распаковка, правка, упаковка заново. Без bash, git и tar тесты пропускаются.
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
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
