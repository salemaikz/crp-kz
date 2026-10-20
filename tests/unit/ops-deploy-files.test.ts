// Статическая проверка комплекта выкладки deploy/ (ops §7.1): PM2, nginx, заголовки, скрипты, крон,
// шаблоны env, страница обслуживания, правила «Без ИИ-шума» для документов.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const DEPLOY = join(ROOT, 'deploy');
const read = (...p: string[]) => readFileSync(join(DEPLOY, ...p), 'utf8');
const BIN = join(DEPLOY, 'bin');
const scripts = readdirSync(BIN).filter((f) => f.endsWith('.sh'));

const temps: string[] = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('ecosystem: cluster, один процесс, Node слушает только 127.0.0.1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crp-eco-'));
  temps.push(dir);
  mkdirSync(join(dir, 'releases', 'r1', 'deploy'), { recursive: true });
  mkdirSync(join(dir, 'shared'), { recursive: true });
  writeFileSync(join(dir, 'shared', 'instance.json'), JSON.stringify({ name: 'crp-test', port: 3456 }));
  writeFileSync(join(dir, 'releases', 'r1', 'RELEASE.json'), JSON.stringify({ id: 'r1' }));
  const file = join(dir, 'releases', 'r1', 'deploy', 'ecosystem.config.cjs');
  copyFileSync(join(DEPLOY, 'ecosystem.config.cjs'), file);
  const cfg = createRequire(import.meta.url)(file);
  assert.equal(cfg.apps.length, 1);
  const app = cfg.apps[0];
  assert.equal(app.exec_mode, 'cluster');
  assert.equal(app.instances, 1);
  assert.equal(app.name, 'crp-test');
  assert.match(app.args, /^start -H 127\.0\.0\.1 -p 3456$/);
  assert.equal(app.cwd, join(dir, 'current'));
  assert.equal(app.env.NODE_ENV, 'production');
  assert.equal(app.env.NEXT_TELEMETRY_DISABLED, '1');
  assert.equal(app.env.NEXT_DEPLOYMENT_ID, 'r1');
  assert.ok(app.kill_timeout >= 10000, 'есть время дождаться текущих запросов');
});

test('nginx: IP клиента перезаписывается, журнал без query и Referer, лимиты и обрыв чужого Host', () => {
  const conf = read('nginx', 'crp.conf.template');
  assert.match(conf, /proxy_set_header X-Forwarded-For\s+\$remote_addr;/);
  assert.match(conf, /limit_req_status 429;/);
  assert.match(conf, /client_max_body_size 2m;/);
  assert.match(conf, /ssl_reject_handshake on;/);
  assert.match(conf, /location \/_next\/static\/ \{[^}]*root \{\{ROOT\}\}\/shared\/static;/s);
  assert.match(conf, /location = \/api\/uploads \{[^}]*client_max_body_size 30m;/s);
  assert.match(conf, /error_page 502 504 \/maintenance\.html;/);
  assert.match(conf, /\{\{DOMAIN\}\}/);
  assert.match(conf, /# BEGIN-TLS[\s\S]*# END-TLS/);
  const fmt = /log_format crp_noquery ([\s\S]*?);/.exec(conf)?.[1] ?? '';
  assert.ok(fmt.length > 20, 'нашли log_format');
  for (const bad of ['$request ', '$args', '$query_string', '$http_referer', '$request_uri']) {
    assert.equal(fmt.includes(bad), false, `в log_format не должно быть ${bad}`);
  }
  assert.match(fmt, /\$uri/);
  // CSP у /api/files/ (с sandbox) приложение ставит само: nginx не скрывает заголовки ответов (PLAN КК-13)
  assert.doesNotMatch(conf, /proxy_hide_header|proxy_set_header\s+Content-Security-Policy/i);
  assert.doesNotMatch(read('nginx', 'crp-security-headers.conf'), /proxy_hide_header/);
});

test('заголовки безопасности: HSTS, CSP с frame-ancestors none, запрет фреймов', () => {
  const h = read('nginx', 'crp-security-headers.conf');
  assert.match(h, /add_header Strict-Transport-Security "max-age=\d+" always;/);
  assert.doesNotMatch(h, /includeSubDomains|preload/, 'includeSubDomains - решение владельца (ops §9, п. 8)');
  assert.match(h, /Content-Security-Policy "[^"]*frame-ancestors 'none'/);
  assert.match(h, /X-Content-Type-Options "nosniff"/);
  assert.match(h, /X-Frame-Options "DENY"/);
  assert.match(h, /frame-src https:\/\/www\.youtube-nocookie\.com/);
});

test('скрипты: set -euo pipefail и bash -n', () => {
  assert.ok(scripts.includes('deploy.sh') && scripts.includes('rollback.sh') && scripts.includes('backup.sh') && scripts.includes('restore.sh'));
  for (const f of scripts) {
    const text = readFileSync(join(BIN, f), 'utf8');
    if (f !== 'lib.sh') {
      assert.match(text.split('\n')[0] ?? '', /^#!\/usr\/bin\/env bash$/, `${f}: shebang`);
      assert.match(text, /^set -E?euo pipefail$/m, `${f}: set -euo pipefail`);
    }
    const r = spawnSync('bash', ['-n', join(BIN, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: bash -n\n${r.stderr}`);
  }
});

const hasShellcheck = spawnSync('sh', ['-c', 'command -v shellcheck'], { stdio: 'ignore' }).status === 0;
test('скрипты: shellcheck (предупреждения и ошибки)', { skip: hasShellcheck ? false : 'shellcheck не установлен' }, () => {
  const r = spawnSync('shellcheck', ['-S', 'warning', '-x', ...scripts], { cwd: BIN, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('deploy.sh: код db:status разбирается явно, сборка идёт без доступа к БД', () => {
  const t = read('bin', 'deploy.sh');
  // rc=0; ... || rc=$?: set -e не должен обрывать скрипт на коде 3 до бэкапа
  assert.match(t, /src=0\n[^\n]*db-migrate\.ts --status[^\n]*\|\| src=\$\?/);
  const sw = /case "\$src" in([\s\S]*?)esac/.exec(t)?.[1] ?? '';
  assert.match(sw, /^\s*0\)/m);
  assert.match(sw, /^\s*3\)[\s\S]*BACKUP_SCRIPT[^\n]*--label "pre-deploy-/m);
  assert.match(sw, /^\s*\*\)[^\n]*die 2/m);
  // сборка получает недоступный адрес БД вместо адреса из .env.production
  const build = /npm run build/.exec(t);
  assert.ok(build);
  const line = t.split('\n').find((l) => l.includes('npm run build')) ?? '';
  assert.match(line, /DATABASE_URL="\$BUILD_DATABASE_URL"/);
  assert.match(line, /NEXT_DEPLOYMENT_ID="\$ID"/);
  assert.match(t, /BUILD_DATABASE_URL="postgres:\/\/[^:@"]+@127\.0\.0\.1:9\//, 'в адресе заглушки нет пароля');
  // порядок: миграции строго после сборки
  assert.ok(t.indexOf('npm run build') < t.indexOf('scripts/db-migrate.ts'));
  assert.ok(t.indexOf('scripts/ops-preflight.ts') < t.indexOf('npm run build'));
  assert.match(t, /flock -n 9/);
});

test('крон: UTC без часового пояса, всё через /usr/local/lib/crp, run-script с именами из PLAN К-10', () => {
  const lines = read('cron', 'crp.cron').split('\n');
  const jobs = lines.filter((l) => l.trim() && !l.startsWith('#') && !/^[A-Z_]+=/.test(l));
  assert.ok(jobs.length >= 7);
  assert.equal(lines.some((l) => /^\s*CRON_TZ\s*=/.test(l)), false);
  for (const j of jobs) {
    const m = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(\S+)\s+(\/\S+)/.exec(j);
    assert.ok(m, `разбор строки: ${j}`);
    assert.ok(['crp', 'postgres'].includes(m[2] ?? ''), `пользователь ${m[2]}`);
    assert.ok((m[3] ?? '').startsWith('/usr/local/lib/crp/'), `путь ${m[3]}`);
    // журнал бэкапа БД лежит вне каталога crp (D-041): его пишет postgres
    assert.match(j, m[2] === 'postgres' ? />> \/var\/log\/crp-backup\/backup\.log 2>&1$/ : />> \/var\/log\/crp\/\S+\.log 2>&1$/);
  }
  const find = (name: string) => jobs.find((j) => j.includes(`run-script.sh ${name}`));
  assert.match(find('mail-worker') ?? '', /^\* \* \* \* \* /, 'очередь писем раз в минуту');
  assert.match(find('send-reminders') ?? '', /^0 4-14 \* \* \* /, '09-19 по Астане = 04-14 UTC');
  assert.ok(find('files-sweep'), 'files-sweep в кроне, без проверки флага (К-11)');
  for (const name of ['mail-worker', 'send-reminders', 'files-sweep']) {
    assert.ok(existsSync(join(ROOT, 'scripts', `${name}.ts`)), `scripts/${name}.ts существует`);
  }
  // вне run-script.sh приложение из крона не запускается
  assert.equal(jobs.some((j) => /\bnode\b|\bnpm\b|\btsx\b/.test(j)), false);
});

test('run-script.sh: flock, timeout и защита имени', () => {
  const t = read('bin', 'run-script.sh');
  assert.match(t, /flock -n 8/);
  assert.match(t, /timeout --foreground "\$TIMEOUT"/);
  assert.match(t, /\^\[a-z0-9-\]\+\$/);
});

test('sudoers: crpdeploy получает только pm2 от crp и бэкап перед выкладкой от postgres', () => {
  const rules = read('sudoers', 'crpdeploy').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.deepEqual(rules, [
    'crpdeploy ALL=(crp) NOPASSWD: /usr/bin/pm2',
    'crpdeploy ALL=(postgres) NOPASSWD: /usr/local/lib/crp/backup.sh --label pre-deploy-*',
  ]);
});

/** Ключи KEY=VALUE шаблона env (закомментированные не считаются). */
function envKeys(text: string): string[] {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] ?? '');
}

test('app.env.example ⊆ .env.example, исключения только ops-only', () => {
  const rootKeys = new Set(envKeys(readFileSync(join(ROOT, '.env.example'), 'utf8')));
  const opsOnly = /^(BACKUP_\w+|ALERT_\w+|DOMAIN)$/;
  const keys = envKeys(read('env', 'app.env.example'));
  assert.ok(keys.length > 15);
  const extra = keys.filter((k) => !rootKeys.has(k) && !opsOnly.test(k));
  assert.deepEqual(extra, []);
  // ключи, которые preflight проверяет на проде, обязаны быть в шаблоне
  for (const k of ['DATABASE_URL', 'SESSION_SECRET', 'NEXT_PUBLIC_SITE_URL', 'TRUSTED_PROXY_HOPS', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', 'NEXT_TELEMETRY_DISABLED']) {
    assert.ok(keys.includes(k), `в app.env.example нет ${k}`);
  }
  // функции выключены до приёмки (D-025), демо-режим не задан
  const text = read('env', 'app.env.example');
  for (const f of ['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS', 'UPLOADS', 'LEGAL', 'CERT_PDF']) {
    assert.match(text, new RegExp(`^FEATURE_${f}=0$`, 'm'));
  }
  for (const k of ['DEMO_MODE', 'SEED_DEMO', 'PGLITE_DIR']) assert.match(text, new RegExp(`^${k}=$`, 'm'));
  assert.match(text, /^DB_MIGRATE_ON_START=0$/m);
  assert.match(text, /^MAIL_TRANSPORT=outbox$/m);
  assert.doesNotMatch(text, /^NODE_ENV=/m);
});

test('backup.env.example: решения владельца (D-029) - пустые параметры, а не выдуманные значения', () => {
  const text = read('env', 'backup.env.example');
  assert.match(text, /^BACKUP_REMOTE=$/m);
  assert.match(text, /^BACKUP_FILES_REMOTE=$/m);
  assert.match(text, /^BACKUP_FILES_REMOTE_SSH_KEY=$/m);
  assert.match(text, /D-029 ПРЕДЛОЖЕНО/);
  assert.match(read('env', 'backup-recipients.example'), /age1<открытый-ключ-хранителя-1>/);
  assert.match(read('env', 'monitor.env.example'), /^ALERT_TELEGRAM_BOT_TOKEN=$/m);
});

test('maintenance.html: ru и kk совпадают по ключам, нет внешних адресов', () => {
  const html = read('nginx', 'maintenance.html');
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<section lang="kk">/);
  assert.doesNotMatch(html, /https?:\/\/|src=|<link /i);
  const sec = (lang: string) => new RegExp(`<section lang="${lang}">([\\s\\S]*?)</section>`).exec(html)?.[1] ?? '';
  const keys = (s: string) => [...s.matchAll(/data-key="(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys(sec('ru')), ['body', 'title']);
  assert.deepEqual(keys(sec('kk')), keys(sec('ru')));
  for (const lang of ['ru', 'kk']) {
    const text = sec(lang).replace(/<[^>]+>/g, '').trim();
    assert.ok(text.length > 40, `${lang}: текст не пуст`);
  }
});

test('документы и шаблоны: без «→», эмодзи, лозунгов и восклицательных знаков (BRAND, «Без ИИ-шума»)', () => {
  const files = [...walk(DEPLOY), ...walk(join(ROOT, 'docs', 'ops'))];
  const bad: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (/→|\p{Extended_Pictographic}/u.test(text)) bad.push(`${relative(ROOT, f)}: стрелка или эмодзи`);
    if (/\.(md|html)$/.test(f) && /!/.test(text.replace(/<!doctype html>|<!--[\s\S]*?-->/gi, ''))) bad.push(`${relative(ROOT, f)}: «!»`);
  }
  assert.deepEqual(bad, []);
});

test('install-ops.sh: все копируемые скрипты существуют', () => {
  const t = read('bin', 'install-ops.sh');
  const list = /for f in ([a-z -]+); do/.exec(t)?.[1]?.split(' ') ?? [];
  assert.ok(list.length >= 6);
  for (const n of list) assert.ok(existsSync(join(BIN, `${n}.sh`)), `${n}.sh`);
  for (const rel of ['cron/crp.cron', 'logrotate/crp', 'sudoers/crpdeploy', 'nginx/crp.conf.template', 'nginx/crp-security-headers.conf', 'nginx/maintenance.html']) {
    assert.ok(existsSync(join(DEPLOY, rel)), rel);
  }
});

test('Postgres: значения параметров не попадают в журнал медленных запросов и ошибок', () => {
  const conf = read('postgres', 'postgresql.conf.d', 'crp.conf');
  assert.match(conf, /^log_parameter_max_length = 0$/m);
  assert.match(conf, /^log_parameter_max_length_on_error = 0$/m);
});

test('install-ops.sh: releases с setgid, журнал бэкапа вне каталога crp, права каталогов (D-041)', () => {
  const t = read('bin', 'install-ops.sh');
  assert.match(t, /as_deploy install -d -m 2750 -g crp "\$ROOT\/releases"/);
  assert.match(read('logrotate', 'crp'), /\/var\/log\/crp-backup\/backup\.log \{/);
  assert.match(read('cron', 'crp.cron'), /\/var\/log\/crp-backup\/backup\.log/);
  assert.doesNotMatch(read('cron', 'crp.cron') + read('logrotate', 'crp'), /\/var\/log\/crp\/backup\//);
  assert.match(t, /install -d -m 0750 -o crp -g adm \/var\/log\/crp$/m);
  assert.match(t, /install -d -m 0750 -o postgres -g adm \/var\/log\/crp-backup$/m);
  assert.match(t, /install -d -m 1775 -o postgres -g crp \/var\/lib\/crp-ops$/m);
  assert.match(read('logrotate', 'crp'), /crp-backup\/backup\.log \{[^}]*su postgres adm/);
});

test('install-ops.sh: корень с current принадлежит пользователю выкладки, а не root (gate5-fixes)', () => {
  const t = read('bin', 'install-ops.sh');
  assert.match(t, /install -d -m 0751 -o crpdeploy -g crp "\$ROOT"$/m);
  assert.doesNotMatch(t, /-o root -g crp "\$ROOT"/);
  // группа crp в корне без записи (0751), приложение новых путей записи не получает
  assert.doesNotMatch(t, /(chmod|install -d -m) (0?[0-7]?[0-7][2367][0-7]|[0-7]*[2367]) [^\n]*"\$ROOT"$/m);
  assert.match(read('bin', 'lib.sh'), /ln -s [^\n]*\|\| die 2 "нет права записи в \$CRP_ROOT"/);
  assert.match(read('bin', 'lib.sh'), /mv -T [^\n]*\|\| die 2 "нет права записи в \$CRP_ROOT"/);
});

test('install-ops.sh: граница crpdeploy -> root: под корнем root не делает chown/chmod и не идёт по ссылкам', () => {
  const t = read('bin', 'install-ops.sh');
  // единственный install с -o crpdeploy - сам корень; остальное под $ROOT создаёт crpdeploy без -o
  const owned = t.split('\n').filter((l) => /^\s*(run )?install [^\n]*-o crpdeploy/.test(l));
  assert.deepEqual(owned.map((l) => l.trim()), ['run install -d -m 0751 -o crpdeploy -g crp "$ROOT"']);
  assert.match(t, /as_deploy\(\) \{ run runuser -u crpdeploy -- "\$@"; \}/);
  for (const sub of ['shared"', 'shared/static"', 'shared/state"', 'shared/maintenance/maintenance.html"']) {
    assert.ok(t.includes(`"$ROOT/${sub}`), sub);
  }
  assert.match(t, /no_link "\$ROOT" "\$ROOT\/releases"[^\n]*\\\n[^\n]*instance\.json[^\n]*maintenance\.html"/);
  assert.doesNotMatch(t, /^[^#\n]*\b(chown|chmod) [^\n]*\$ROOT/m);
  assert.doesNotMatch(t, /^[^#\n]*>\s*"\$ROOT\//m);
  // instance.json: временный файл в /etc/crp, в корень кладёт crpdeploy через install -T
  assert.match(t, /mktemp \/etc\/crp\/instance/);
  assert.match(t, /runuser -u crpdeploy -- install -T [^\n]*"\$ROOT\/shared\/instance\.json"/);
  assert.match(t, /as_deploy install -m 0644 -g crp "\$DEPLOY_DIR\/nginx\/maintenance\.html"/);
});

test('deploy.sh: default ACL на .next/cache и предупреждения об отсутствии setfacl', () => {
  const t = read('bin', 'deploy.sh');
  assert.match(t, /setfacl -d -m "g:\$APP_GROUP:rwX" "\$REL\/\.next\/cache"/);
  assert.match(t, /нет setfacl \(пакет acl\)/);
});

test('install-ops.sh: предупреждает, если имя статуса занято каталогом или ссылкой', () => {
  assert.match(read('bin', 'install-ops.sh'), /-d \/var\/lib\/crp-ops\/\$st \|\| -L [^\n]*\n[^\n]*занят каталогом или ссылкой/);
});

test('nginx: журнал ошибок не пишет строки запросов с query', () => {
  assert.match(read('nginx', 'crp.conf.template'), /error_log\s+\S+\s+crit;/);
});

test('healthcheck.sh: токен бота не в argv curl', () => {
  const t = read('bin', 'healthcheck.sh');
  assert.match(t, /curl [^\n]*-K -/);
  assert.doesNotMatch(t, /curl [^\n]*bot\$TG_TOKEN/);
});

test('install-ops.sh: комплект берётся мимо зеркала crpdeploy, каталог выгрузки проверяется (ops-polish)', () => {
  const t = read('bin', 'install-ops.sh');
  const head = t.split('set -euo pipefail')[0] ?? '';
  assert.match(head, /git clone --depth 1 --branch <тег>/);
  assert.doesNotMatch(head, /git archive/);
  // боевой запуск отказывает (код 2), если выгрузка или родители не у root; обход только явным флагом
  assert.match(t, /stat -c '%u %a'/);
  assert.match(t, /--allow-foreign-owner/);
  assert.match(t, /принадлежит не root/);
  const runbook = readFileSync(join(ROOT, 'docs', 'ops', 'RUNBOOK.md'), 'utf8');
  assert.match(runbook, /git clone --depth 1 --branch <тег>/);
  assert.doesNotMatch(runbook, /crpdeploy git -C \/srv\/crp\/repo\.git archive/);
});

test('install-ops.sh: чтение instance.json от crpdeploy, проверка чтения выгрузки и nginx -t до замены', () => {
  const t = read('bin', 'install-ops.sh');
  assert.match(t, /PORT="\$\(runuser -u crpdeploy -- jq -r '\.port \/\/ 3000' "\$ROOT\/shared\/instance\.json"\)"/);
  // проверка чтения идёт до первого действия (первой записи в /etc или каталоги)
  const readable = t.indexOf('test -r "$DEPLOY_DIR/nginx/maintenance.html"');
  assert.ok(readable > 0);
  assert.ok(readable < t.indexOf('run install -d -m 0751 -o crpdeploy'), 'проверка до первого действия');
  assert.match(t, /exit 2; \}\nfi/);
  // конфиг nginx: временный файл, nginx -t, возврат прежнего при провале
  assert.match(t, /new_conf="\$\(mktemp \/etc\/nginx\/crp\.conf\./);
  assert.ok(t.indexOf('if ! nginx -t') > t.indexOf('mv -f "$new_conf" "$site"'));
  assert.match(t, /if ! nginx -t; then[\s\S]*mv -f "\$old_conf" "\$site"/);
});
