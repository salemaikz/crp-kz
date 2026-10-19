# Проект «ops»: выкладка на сервер ЦРП в Казахстане (#24, ops.1)

> Проект до реализации. После реализации источник истины — код и docs/lms/BUILD.md; решения — DECISIONS.md. Статусы решений — только в DECISIONS.md.

Уровень: T2 (доступы, ПДн, миграции, бэкапы). Автор: architect. Код не написан, файлы репозитория
не менялись.

Прочитано: `AGENTS.md`, `docs/lms/BUILD.md` (§2, §5, §6, §10, §11), `docs/lms/SPEC.md` §8–9,
`DECISIONS.md` (D-007, D-009, D-012, D-015…D-023), `docs/brand/BRAND.md` («Без ИИ-шума»),
`src/lib/{env.ts,db/*,auth/{clientIp,rateLimit,password,actions}.ts,admin/audit.ts}`, `src/proxy.ts`,
`scripts/*`, `migrations/*`, `package.json`, `next.config.ts`, `.env.example`, `.gitignore`,
`.github/workflows/ci.yml`, `playwright.config.ts`, issue #24, гайд Next 16
`node_modules/next/dist/docs/01-app/02-guides/self-hosting.md` и `deploymentId.md`,
Сверено с проектными документами
`design/mail-account.md` (крон `mail-worker`, `send-reminders`) и `design/uploads.md`
(`STORAGE_DIR`, `/api/uploads` 30 МБ).

---

## 1. Цель и границы

**Цель.** Платформа работает в production на сервере ЦРП в РК (D-009). В комплекте:
воспроизводимая установка, выкладка без простоя, откат за минуту, миграции под отдельной ролью,
зашифрованные бэкапы с проверкой восстановления, мониторинг и runbook. Всё лежит в публичном
репозитории без секретов, IP и доступов.

**Входит:**
- `deploy/`: конфиг PM2, шаблоны nginx, скрипты выкладки, отката, бэкапа и восстановления, крон,
  logrotate, sudoers, SQL ролей и прав, шаблоны env без значений;
- `docs/ops/RUNBOOK.md`;
- код: `/api/health`; режим «миграции только проверяются» при старте в production;
  `scripts/{create-admin,ops-preflight,db-grants}.ts`; флаг `--status` в `scripts/db-migrate.ts`;
- тесты на всё перечисленное.

**Не входит:**
- выбор хостера, покупка сервера, DNS — решает владелец (§9);
- приём алертов (Telegram, почта) — подключается конфигом после решения владельца, по умолчанию
  только локальный журнал;
- WAL-архив и восстановление на момент времени (PITR) — после MVP, RPO в MVP 24 ч (§9);
- управление членством в организациях из админки. **Найден пробел:** `organization_members`
  заполняет только сид, UI для этого нет. На чистом проде «Команда» не заработает. Нужен отдельный
  issue в зону admin. `create-admin` закрывает только первый шаг: организацию-владельца и её
  первого руководителя;
- CI-деплой по SSH. Выкладку запускает оператор на сервере (§3.1, отвергнутые варианты).

**Отступление от текста #24.** В issue написано «сборка в CI». Предлагаю иначе: CI проверяет
коммит, а сервер собирает тот же тег из git. Пункт «прод = git-checkout с тегами, миграции не
расходятся с git» сохраняется, причины — в D-027. Подтверждает оркестратор.

**Решения владельца остаются открытыми** (§9): хостер и размер сервера, домен, где лежит
вторая копия бэкапов в РК, у кого ключ расшифровки, канал алертов, внешний uptime-монитор,
список людей с SSH, стейдж.

---

## 2. Модель данных

**Новых миграций приложения нет.** Схема `migrations/*` не меняется. Ops добавляет SQL уровня
кластера. Он не входит в `migrations/`, потому что имена ролей зависят от конкретной установки,
а в PGlite таких ролей нет:

- `deploy/postgres/roles.sql` — один раз при установке, от суперпользователя `postgres`;
- `deploy/postgres/grants.sql` — идемпотентный, выполняется после **каждого** прогона миграций
  (deploy.sh → `scripts/db-grants.ts`) и после восстановления (restore.sh).

### 2.1 Роли

| Роль | Права | Кто использует |
|---|---|---|
| `crp_owner` | владелец БД `crp` и схемы `public`, DDL | только `db-migrate`, `db-grants` во время выкладки (`/etc/crp/migrate.env`) |
| `crp_app` | `CONNECT`; `USAGE` на схему; `SELECT/INSERT/UPDATE/DELETE` на таблицы; `audit_log` — только `SELECT/INSERT`; `schema_migrations` — только `SELECT` | приложение, крон-скрипты, `create-admin` (`/etc/crp/app.env`) |
| `postgres` (ОС, peer) | суперпользователь | `backup.sh`, `restore.sh`, разовые работы DBA |

Обе LOGIN-роли без SUPERUSER, CREATEDB, CREATEROLE и REPLICATION. Подключение — только TCP
`127.0.0.1` с `hostssl … scram-sha-256` (`sslmode=require`, как требует #24). Пароли в файлах
репозитория не встречаются: их задают через `\password`.

### 2.2 `deploy/postgres/roles.sql` (полный текст)

```sql
-- Разовая установка БД и ролей платформы обучения ЦРП. Запуск (от ОС-пользователя postgres):
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v db=crp -v owner=crp_owner -v app=crp_app \
--        -f deploy/postgres/roles.sql
-- Пароли здесь не задаются. После запуска: \password crp_owner и \password crp_app.
-- Повторный запуск безопасен: создаёт только то, чего нет.

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5', :'owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 40', :'app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec

-- ICU 'und' правильно сортирует кириллицу, включая казахские буквы (Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І).
-- После обновления ICU в ОС нужен REINDEX (см. RUNBOOK).
SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE %L LOCALE %L',
              :'db', :'owner', 'UTF8', 'und', 'C.UTF-8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', :'db', :'owner', :'app') \gexec

\connect :db
ALTER SCHEMA public OWNER TO :"owner";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";

-- Предохранители на уровне роли: зависший запрос или забытая транзакция не держат блокировки.
SELECT format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L', :'app', :'db', '30s') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET idle_in_transaction_session_timeout = %L', :'app', :'db', '60s') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L', :'owner', :'db', '5s') \gexec
```

### 2.3 `deploy/postgres/grants.sql` (полный текст)

```sql
-- Права приложения на объекты схемы. Идемпотентно; выполняется после каждого прогона миграций
-- (scripts/db-grants.ts от crp_owner) и после восстановления (restore.sh от postgres).
-- Имена ролей приходят параметрами сессии crp.app_role и crp.owner_role (set_config), а не
-- склейкой строк. Схема — текущая (в тестах на Postgres — временная схема теста).
DO $$
DECLARE
  app   text := current_setting('crp.app_role');
  owner text := current_setting('crp.owner_role');
  s     text := current_schema();
BEGIN
  IF app !~ '^[a-z_][a-z0-9_]{0,62}$' OR owner !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'grants.sql: недопустимое имя роли';
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, app);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', s, app);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', s, app);
  -- Таблицы из будущих миграций получают те же права сразу (страховка, если db-grants не запустили).
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', owner, s, app);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', owner, s, app);

  -- Журнал действий только дописывается: приложение не может править и удалять записи.
  IF to_regclass(format('%I.audit_log', s)) IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.audit_log FROM %I', s, app);
  END IF;
  -- Учёт миграций ведёт только владелец схемы.
  IF to_regclass(format('%I.schema_migrations', s)) IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.schema_migrations FROM %I', s, app);
  END IF;
END
$$;
```

Проверено по коду: `UPDATE` и `DELETE` для `audit_log` нигде не выполняются (`grep` по `src`).
FK-действия (`ON DELETE CASCADE`) Postgres выполняет с правами владельца таблицы, а не
`crp_app`, поэтому отзыв прав их не ломает.

### 2.4 Последствие для кода: приложение в production не делает DDL

Сейчас `getDb()` при старте вызывает `migrate()`, а тот — `CREATE TABLE IF NOT EXISTS
schema_migrations`. От имени `crp_app` это ошибка: в PG15+ право CREATE на схему проверяется
до проверки «уже существует». Поэтому:

- `autoMigrateEnabled(env)` возвращает true при `DB_MIGRATE_ON_START=1` или когда
  `DB_MIGRATE_ON_START≠0` и при этом (`isDemo()` или `NODE_ENV≠production`). В production с
  `DATABASE_URL` по умолчанию результат false;
- если автонакатка выключена, `getDb()` вызывает `assertMigrated()`: читает `schema_migrations`
  (только SELECT) и падает с `MigrationsPendingError`, если на диске есть ненакатанные файлы.
  Это fail closed. Миграции, которых нет на диске (БД новее кода после отката), — норма, не
  ошибка;
- **требование к соседним проектам.** `scripts/mail-worker.ts` и `scripts/send-reminders.ts`
  (`mail-account.md`) и `scripts/files-sweep.ts` (`uploads.md`) вызывают `prepareDb(handle)`,
  а не `migrate(handle)`. Иначе в production они упадут на правах.

---

## 3. Модули и файлы

### 3.1 Выкладка — рекомендуемый вариант

**Каталоги релизов + симлинк `current` + PM2 cluster с одним экземпляром + `pm2 startOrReload`.**

```
/srv/crp/                          root:crp 0751
  repo.git/                        bare-зеркало github.com/salemaikz/crp-kz (crpdeploy)
  releases/<UTC-ts>-<tag>/         crpdeploy:crp 0750; .next/cache — 2770 (пишет crp)
     RELEASE.json                  {id, tag, sha, builtAt}
     .env.production -> /etc/crp/app.env
  current -> releases/<id>         атомарная замена: ln -s … current.tmp && mv -T current.tmp current
  shared/
     instance.json                 {"name":"crp","port":3000,"configDir":"/etc/crp","smokePort":3109}
     static/_next/static/          объединение .next/static всех живых релизов (читает nginx)
     maintenance/maintenance.html
     state/{previous,deploy.log}
/etc/crp/                          root:crp 0750
  app.env        root:crp 0640     переменные приложения (DATABASE_URL роли crp_app, …)
  migrate.env    root:crpdeploy 0640  DATABASE_URL роли crp_owner, MIGRATE_LOCK_TIMEOUT_MS
  backup.env     root:postgres 0640   настройки бэкапа
  monitor.env    root:crp 0640     настройки алертов (по умолчанию пусто)
  backup-recipients.txt root 0644  открытые ключи age
/usr/local/lib/crp/                root 0755 — копии deploy/bin/* (ставит install-ops.sh)
/var/lib/crp/files                 crp 0700 — STORAGE_DIR (uploads.md)
/var/lib/crp-ops/                  статусы бэкапа и мониторинга
/var/log/crp/                      crp:adm 0750 — логи PM2 и крона
/var/backups/crp/{daily,weekly,monthly,files}  0700
```

ОС-пользователи:
- `crp` — запускает PM2 и крон приложения, только читает код;
- `crpdeploy` — собирает релизы и знает пароль владельца схемы; входит в группу `crp`.
  `sudoers`: `crpdeploy ALL=(crp) NOPASSWD: /usr/bin/pm2`.

Люди входят по SSH под своими учётками и запускают
`sudo -u crpdeploy /usr/local/lib/crp/deploy.sh v0.3.0`. Скрипты эксплуатации принадлежат root
и обновляются отдельно (`install-ops.sh`), поэтому код из релиза не выполняется от
`postgres`/root.

**Почему cluster ×1.** При `pm2 reload` в режиме cluster PM2 сначала поднимает новый воркер на
том же порту, ждёт `listening` и только потом гасит старый (SIGINT, затем `kill_timeout`). Next
16 дожидается текущих запросов (self-hosting.md: «graceful shutdown … drain 10–30 s»). Одного
экземпляра достаточно, потому что лимиты частоты живут в памяти процесса (D-018, D-022,
`rateLimit.ts`). При N воркерах лимит фактически вырос бы в N раз. Пул БД тоже один. PGlite в
production не используется.

**Почему не swap `.next` на месте.** Подмена `.next` на месте оставляет окно без сборки:
процесс падает при рестарте, а у открытых страниц ломаются server actions старой сборки. Здесь новый релиз собирается в отдельном каталоге, а работающий не
трогается. Переключение — атомарный `rename` симлинка.

**Расхождение версий (Next self-hosting, «Version Skew»):**
- сборка с `NEXT_DEPLOYMENT_ID=<release-id>`. Клиент со старой страницей получает полную
  перезагрузку вместо поломанной навигации или server action. Правка `next.config.ts` не нужна:
  переменная читается при `next build`;
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (32 байта base64) — один для всех релизов, в `app.env`.
  Шифрованные замыкания server actions переживают перезапуск;
- `/_next/static/` nginx отдаёт из `shared/static`. Там лежат ассеты **всех** живых релизов,
  поэтому чанки старой страницы не дают 404. Чистка — только файлов, которых нет ни в одном
  оставленном релизе.

**Отвергли:**
- *fork + `pm2 restart`* — 2–5 с ответов 502 при каждой выкладке;
- *cluster с 2+ экземплярами* — ослабляет лимиты D-018/D-022 в N раз, удваивает пулы;
- *blue/green на двух портах с переключением upstream в nginx* — тоже без простоя, но больше
  движущихся частей (include-файл upstream, reload nginx, два имени в PM2). Это запасной вариант,
  если приёмка на стейдже покажет 5xx при reload;
- *сборка в CI и доставка артефакта* — на сервере нужен токен GitHub или в секретах CI —
  SSH-ключ к серверу. Кроме того, `NEXT_PUBLIC_SITE_URL` вшивается при сборке. Сборка на сервере
  из тега даёт ровно тот код, что в git;
- *Docker* — лишний слой для одного процесса; PM2 требует #24.

### 3.2 Файлы в репозитории

| Путь | Зона | Что внутри |
|---|---|---|
| `deploy/ecosystem.config.cjs` | ops (B) | §3.3 |
| `deploy/nginx/crp.conf.template` | ops (B) | §3.4; `{{DOMAIN}}`, `{{ROOT}}`, `{{PORT}}` подставляет `install-ops.sh` |
| `deploy/nginx/crp-security-headers.conf` | ops (B) | §3.4 |
| `deploy/nginx/maintenance.html` | ops (B) | §4.3 |
| `deploy/bin/deploy.sh` | ops (B) | §3.5 |
| `deploy/bin/rollback.sh` | ops (B) | §3.6 |
| `deploy/bin/backup.sh` | ops (B) | §3.7 |
| `deploy/bin/restore.sh` | ops (B) | §3.8 |
| `deploy/bin/run-script.sh` | ops (B) | запуск `scripts/<name>.ts` из `current` по крону |
| `deploy/bin/healthcheck.sh` | ops (B) | §3.9 |
| `deploy/bin/install-ops.sh` | ops (B) | от root: копирует `deploy/bin/*` в `/usr/local/lib/crp`, ставит cron, logrotate, sudoers, nginx-сайт из шаблона (`--domain`). Идемпотентный, `--dry-run` |
| `deploy/bin/lib.sh` | ops (B) | общие функции: `log`, `die`, `read_env_file` (разбор `KEY=VALUE` без `source`/`eval`), `instance_json` |
| `deploy/cron/crp.cron` | ops (B) | §3.10 |
| `deploy/logrotate/crp` | ops (B) | `/var/log/crp/*.log`: daily, rotate 14, compress, delaycompress, copytruncate, missingok, notifempty, `su crp adm` |
| `deploy/sudoers/crpdeploy` | ops (B) | `crpdeploy ALL=(crp) NOPASSWD: /usr/bin/pm2`; `crpdeploy ALL=(postgres) NOPASSWD: /usr/local/lib/crp/backup.sh --label pre-deploy-*` |
| `deploy/env/app.env.example` | ops (B) | §3.11, без значений секретов |
| `deploy/env/migrate.env.example`, `backup.env.example`, `monitor.env.example` | ops (B) | §3.11 |
| `deploy/postgres/roles.sql`, `grants.sql` | db (A) | §2.2, §2.3 |
| `deploy/postgres/postgresql.conf.d/crp.conf` | ops (B) | `listen_addresses='localhost'`, `ssl=on`, `password_encryption=scram-sha-256`, `log_min_duration_statement=1000`, `log_statement='none'`, `log_line_prefix='%m [%p] %u@%d '`, памятка по `shared_buffers` (25 % RAM) |
| `deploy/postgres/pg_hba.snippet` | ops (B) | `local all postgres peer`; `hostssl crp crp_app 127.0.0.1/32 scram-sha-256`; `hostssl crp crp_owner 127.0.0.1/32 scram-sha-256`; остальное — reject |
| `deploy/README.md` | ops (B) | одна страница: что где, ссылка на RUNBOOK |
| `docs/ops/RUNBOOK.md` | ops (B) | §3.12 |
| `src/lib/db/migrate.ts` (правка) | db (A) | §3.13 |
| `src/lib/db/index.ts` (правка) | db (A) | §3.13 |
| `src/lib/ops/release.ts` | A | §3.14 |
| `src/lib/ops/health.ts` | A | §3.14 |
| `src/lib/ops/preflight.ts` | A | §3.15 |
| `src/lib/ops/createAdmin.ts` | A | §3.16 |
| `src/app/api/health/route.ts` | A | §3.14 |
| `scripts/db-migrate.ts` (правка) | A | флаг `--status` |
| `scripts/db-grants.ts` | A | выполняет `deploy/postgres/grants.sql` |
| `scripts/ops-preflight.ts` | A | §3.15 |
| `scripts/create-admin.ts` | A | §3.16 |
| `.env.example` (правка) | A | `DB_MIGRATE_ON_START`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `NEXT_TELEMETRY_DISABLED`, `MIGRATE_LOCK_TIMEOUT_MS` с комментариями |

### 3.3 `deploy/ecosystem.config.cjs`

```js
// PM2: один воркер в режиме cluster — reload без простоя, лимиты частоты в памяти одного процесса.
const fs = require('node:fs');
const path = require('node:path');
// __dirname — реальный путь релиза (/srv/crp/releases/<id>/deploy), корень установки — на 3 уровня выше.
const root = path.resolve(__dirname, '..', '..', '..');
const inst = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'instance.json'), 'utf8'));
module.exports = {
  apps: [{
    name: inst.name,                                   // 'crp' | 'crp-staging'
    cwd: path.join(root, 'current'),                   // симлинк: новый воркер стартует в новом релизе
    script: 'node_modules/next/dist/bin/next',
    args: `start -H 127.0.0.1 -p ${inst.port}`,
    exec_mode: 'cluster',
    instances: 1,
    node_args: '--max-old-space-size=1024',
    env: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    listen_timeout: 20000,
    kill_timeout: 20000,                               // дренаж запросов при reload
    max_memory_restart: '1200M',
    min_uptime: '30s',
    max_restarts: 10,
    exp_backoff_restart_delay: 500,
    out_file: `/var/log/crp/${inst.name}-out.log`,
    error_file: `/var/log/crp/${inst.name}-err.log`,
    merge_logs: true,
    time: true,
  }],
};
```

Секретов в ecosystem нет: Next сам читает `.env.production` (симлинк на `/etc/crp/app.env`) из
каталога релиза. Сама схема с `current` + `startOrReload` — штатная схема `pm2 deploy`. Проверить
на стейдже (§7.4), что после reload `process.cwd()` — новый релиз (`/api/health` → новый
`release`).

### 3.4 nginx

`deploy/nginx/crp.conf.template` (основное; итоговый файл — `/etc/nginx/sites-available/crp.conf`):

```nginx
upstream crp_app { server 127.0.0.1:{{PORT}}; keepalive 16; }

limit_req_zone  $binary_remote_addr zone=crp_req:10m    rate=20r/s;
limit_req_zone  $binary_remote_addr zone=crp_health:1m  rate=2r/s;
limit_conn_zone $binary_remote_addr zone=crp_conn:10m;

# Без query string и Referer: в них ключи заказов, токены сброса пароля и подтверждения email.
log_format crp_noquery '$remote_addr [$time_iso8601] "$request_method $uri $server_protocol" '
                       '$status $body_bytes_sent $request_time $upstream_response_time "$http_user_agent"';

server { listen 80; listen [::]:80; server_name {{DOMAIN}};
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; } }

# Чужой Host — обрыв рукопожатия (защита от подмены Host и сканеров).
server { listen 443 ssl default_server; listen [::]:443 ssl default_server; ssl_reject_handshake on; }

server {
  listen 443 ssl; listen [::]:443 ssl; http2 on;
  server_name {{DOMAIN}};
  ssl_certificate     /etc/letsencrypt/live/{{DOMAIN}}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/{{DOMAIN}}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3; ssl_prefer_server_ciphers off;
  ssl_session_cache shared:CRP:10m; ssl_session_timeout 1d; ssl_session_tickets off;
  server_tokens off;

  access_log /var/log/nginx/crp.access.log crp_noquery;
  error_log  /var/log/nginx/crp.error.log warn;

  client_max_body_size 2m;            # server actions — до 1 МБ (Next), запас на multipart
  client_body_timeout 15s; client_header_timeout 15s; send_timeout 30s; keepalive_timeout 30s;
  limit_req_status 429; limit_conn_status 429;    # не 503: 503 отдаёт только приложение
  limit_conn crp_conn 50;

  include /etc/nginx/snippets/crp-security-headers.conf;

  proxy_http_version 1.1;
  proxy_set_header Host              $host;
  proxy_set_header X-Forwarded-Host  $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  # Перезаписываем, а не дописываем: цепочка из одного доверенного значения (TRUSTED_PROXY_HOPS=1).
  proxy_set_header X-Forwarded-For   $remote_addr;
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_set_header Connection        "";
  proxy_read_timeout 60s;
  proxy_buffering off;                # стриминг App Router (self-hosting.md, «Streaming»)

  location /_next/static/ {
    root {{ROOT}}/shared/static;      # ассеты всех живых релизов — без 404 у старых страниц
    access_log off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    include /etc/nginx/snippets/crp-security-headers.conf;   # add_header не наследуется
  }
  location = /api/health { limit_req zone=crp_health burst=10 nodelay; proxy_pass http://crp_app; }
  location = /api/uploads {           # uploads.md: 30 МБ только здесь, поток без буфера
    limit_req zone=crp_req burst=10 nodelay;
    client_max_body_size 30m; client_body_timeout 120s; proxy_request_buffering off;
    proxy_read_timeout 180s; proxy_pass http://crp_app;
  }
  location / { limit_req zone=crp_req burst=60 nodelay; proxy_pass http://crp_app; }

  error_page 502 504 /maintenance.html;   # только ошибки самого nginx (upstream недоступен)
  location = /maintenance.html { root {{ROOT}}/shared/maintenance; internal; }
}
```

`deploy/nginx/crp-security-headers.conf`:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;   # includeSubDomains — решение владельца (§9)
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests" always;
```

Пояснения:
- шрифты `next/font/google` при сборке скачиваются и отдаются с нашего домена, поэтому
  `font-src 'self'`;
- видео — `youtube-nocookie` (`VideoBlock.tsx`). Закрытый видеохостинг (D-008) добавит свой
  `frame-src` отдельной правкой;
- `'unsafe-inline'` для скриптов нужен инлайн-бутстрапу Next без nonce. Nonce-CSP — отдельная
  задача после MVP, она требует динамического рендера всех страниц.

**HTTPS:** `apt install certbot python3-certbot-nginx` → `certbot certonly --webroot -w
/var/www/certbot -d <domain>` → таймер `certbot.timer` с `--deploy-hook "systemctl reload
nginx"`. OCSP stapling не настраиваем: Let's Encrypt закрыл OCSP в 2025 году.

### 3.5 `deploy/bin/deploy.sh <tag> [--skip-ci-check]`

`set -euo pipefail`, `umask 027`, единственный запуск через `flock -n {{ROOT}}/shared/state/deploy.lock`.
Выполняется от `crpdeploy`. Каждый шаг пишет строку в `shared/state/deploy.log`.

1. **Вход.** Тег по шаблону `^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$`. Читается
   `instance.json` (`name`, `port`, `configDir`, `smokePort`).
2. **Код.** `git -C repo.git fetch --prune --tags origin`. Далее
   `sha=$(git rev-parse "$tag^{commit}")`. Проверка `git merge-base --is-ancestor $sha
   origin/main` (только код из `main`; до появления `main` — ветка из `DEPLOY_BRANCH` в
   `instance.json`). Проверка CI: `curl` публичного
   `api.github.com/repos/salemaikz/crp-kz/commits/$sha/check-runs`. Нужен `conclusion=success`
   для «Проверки и e2e». Иначе отказ; `--skip-ci-check` пишет предупреждение в лог.
3. **Каталог.** `id=$(date -u +%Y%m%d-%H%M%S)-$tag`; `git archive $sha | tar -x -C
   releases/$id`. В релизе нет `.git`, код совпадает с тегом. `RELEASE.json` = `{"id","tag",
   "sha","builtAt"}`. `ln -s $configDir/app.env releases/$id/.env.production`.
4. **Зависимости.** `npm ci --include=dev --no-audit --no-fund`. Dev-зависимости нужны:
   `tsx` для миграций и крона, tailwind для сборки.
5. **Проверка окружения.** `NODE_ENV=production node --env-file=$configDir/app.env --import
   tsx scripts/ops-preflight.ts --db`. Любая `ERROR` → стоп: релиз не собран, прод не тронут.
6. **Сборка.** `NEXT_DEPLOYMENT_ID=$id NEXT_TELEMETRY_DISABLED=1 npm run build`. `prebuild`
   снимок демо пропускает: `DEMO_MODE` не задан. Проверить, что есть `.next/BUILD_ID`. Каталог
   `.next/cache` создать с группой `crp` и правами 2770.
7. **Статика.** `rsync -a releases/$id/.next/static/ shared/static/_next/static/`, без
   `--delete`.
8. **Бэкап перед миграциями.** `NODE_ENV=production node --env-file=$configDir/migrate.env
   --import tsx scripts/db-migrate.ts --status`. Код 0 — бэкап не нужен; 3 — есть ненакатанные
   миграции: тогда `sudo -u postgres /usr/local/lib/crp/backup.sh --label pre-deploy-$id`; любой
   другой код — стоп, прод не тронут. Код разбирать явно (`rc=0; … || rc=$?`), а не через `set -e`:
   иначе код 3 оборвёт скрипт до бэкапа.
9. **Миграции.** `… scripts/db-migrate.ts` от `crp_owner`: одна транзакция, advisory-блокировка,
   `lock_timeout` из `MIGRATE_LOCK_TIMEOUT_MS` (по умолчанию 5000). Ошибка → стоп. Транзакция
   откатилась, прод работает на старом релизе со старой схемой.
10. **Права.** `… scripts/db-grants.ts` (`grants.sql`).
11. **Проверка до переключения.** Под `crpdeploy` запускается `node_modules/.bin/next start -H
    127.0.0.1 -p $smokePort` в новом релизе, в фоне, с `trap kill`. До 60 с ждём, пока
    `curl -fsS 127.0.0.1:$smokePort/api/health` вернёт `status=ok` и `release=$id`, плюс
    `GET /ru` → 200. Процесс гасится. Провал → стоп, переключения нет. Миграции остаются:
    они только добавляют, старый код с ними работает.
12. **Переключение.** `readlink current > shared/state/previous`; `ln -s releases/$id
    current.tmp && mv -T current.tmp current`.
13. **Перезагрузка.** `sudo -u crp -H pm2 startOrReload {{ROOT}}/current/deploy/ecosystem.config.cjs
    --update-env`, затем `sudo -u crp -H pm2 save`.
14. **Проверка после.** До 90 с опрашиваем `127.0.0.1:$port/api/health`, пока не придёт
    `release=$id` и `status=ok`. Провал → автоматический `rollback.sh --to "$(cat
    shared/state/previous)" --reason post-deploy-health` и код выхода 1.
15. **Уборка.** Оставляем 5 последних релизов, а также `current` и `previous` в любом случае.
    Из `shared/static` удаляются только файлы, которых нет ни в одном оставленном релизе
    (`comm -23` по спискам файлов).
16. Итог одной строкой: `deployed <id> sha=<sha> migrations=<n>`.

Переменные для тестов скрипта: `CRP_ROOT` (по умолчанию `/srv/crp`), `CRP_PM2` (по умолчанию
`sudo -u crp -H pm2`), `CRP_SUDO_POSTGRES`, `CRP_NODE` — чтобы тест подменил внешние команды
шимами (§7.1).

Коды выхода: 0 — выложено; 1 — сбой после переключения, откат выполнен; 2 — сбой до
переключения, прод не тронут; 4 — уже идёт другая выкладка.

### 3.6 `deploy/bin/rollback.sh [--to <release-id>] [--reason <text>]`

- По умолчанию целевой релиз — `shared/state/previous`. Если его нет, берётся предпоследний
  по имени в `releases/`.
- Проверки: каталог существует, есть `.next/BUILD_ID` и `RELEASE.json`, цель ≠ текущему.
- Шаги 12–14 из deploy.sh для целевого релиза. `previous` становится прежний `current`, так что
  повторный rollback возвращает обратно.
- **БД не откатывается.** Миграции только добавляют (AGENTS.md), старый код с новой схемой
  работает. `assertMigrated` у старого релиза видит «лишние» миграции — это норма. Порядок
  «добавили колонку → код перестал её читать → убрали» растягивается на два и более релиза
  (RUNBOOK §5).
- Запись в `deploy.log`: `rollback from=<id> to=<id> reason=<…>`. Время отката — около 20 с:
  без сборки, только reload.

### 3.7 `deploy/bin/backup.sh [--verify-restore] [--label <name>] [--files]`

Запуск от `postgres` (peer, без паролей), `umask 077`. Настройки — из `/etc/crp/backup.env`.

Режим БД (по умолчанию):
1. `tmp=$(mktemp -d $BACKUP_DIR/.tmp.XXXX)`, `trap` удаляет его.
2. `pg_dump -d "$BACKUP_DB" -Fc -Z 6 -f $tmp/db.dump`. Снимок согласованный: одна транзакция
   REPEATABLE READ.
3. `pg_restore -l $tmp/db.dump >/dev/null` — архив читается.
4. При `--verify-restore` (крон по воскресеньям):
   - `dropdb --if-exists crp_restorecheck`, затем `createdb -O crp_owner crp_restorecheck`;
   - `pg_restore --no-owner --role=crp_owner --exit-on-error -d crp_restorecheck`;
   - проверки через `psql -tA`: (а) набор таблиц `public` совпадает с источником;
     (б) `schema_migrations` совпадает по именам; (в) `SELECT count(*)` выполняется для
     каждой таблицы; (г) `users` > 0;
   - `dropdb crp_restorecheck`.
5. Шифрование: `age -R $BACKUP_AGE_RECIPIENTS_FILE -o $out.age $tmp/db.dump`. Открытые ключи
   двух хранителей (§9). **Приватного ключа на сервере нет.**
6. Файл `daily/crp-<UTCts>.dump.age` и рядом `.sha256`. В воскресенье — жёсткая ссылка в
   `weekly/`, первого числа — в `monthly/`. С `--label` файл кладётся в `manual/` и не
   ротируется (чистится вручную по RUNBOOK).
7. Ротация: `BACKUP_KEEP_DAILY=14`, `BACKUP_KEEP_WEEKLY=8`, `BACKUP_KEEP_MONTHLY=6`.
8. Вторая копия: если задан `BACKUP_REMOTE`, выполняется `rsync -a --ignore-existing` по SSH в
   хранилище **в РК** (§9). Пустая переменная — копии нет, в статусе `offsite=false`.
9. Статус: `/var/lib/crp-ops/backup-status.json` =
   `{ok, at, file, sizeBytes, verified, offsite}`. При ошибке `trap ERR` пишет `ok=false`.
   Алерт отправляет `healthcheck.sh`.

Режим `--files` (от `crp`, отдельная строка крона): `tar -C $STORAGE_DIR -czf - . | age -R … >
files/files-<ts>.tar.gz.age`, та же ротация и статус `files-status.json`. Если `STORAGE_DIR` не
задан или пуст (флаг `UPLOADS` выключен), режим ничего не делает и выходит с кодом 0.

**Отвергли:**
- *gpg с паролем на сервере* — копия на внешнем хранилище расшифровывается тем же паролем,
  что лежит на сервере;
- *pg_basebackup/WAL (PITR)* — сложнее и в эксплуатации, и в восстановлении; для MVP с ручной
  оплатой RPO 24 ч приемлем, это вопрос владельцу (§9);
- *отдельная роль `crp_backup` с `pg_read_all_data`* — нужен ещё один пароль. Для еженедельной
  проверки восстановления всё равно нужен `CREATE DATABASE`, а peer-доступ `postgres` даёт это
  без пароля.

### 3.8 `deploy/bin/restore.sh --file <*.dump.age|*.dump> --identity <age-key> --target <db> [--force-prod] [--keep]`

- Расшифровывает во временный каталог с `umask 077`. Ключ `--identity` оператор приносит на
  время восстановления (с флешки или из менеджера паролей) и удаляет после.
- Цель ≠ `BACKUP_DB` (по умолчанию `crp_restore_<UTCts>`): `createdb -O crp_owner` →
  `pg_restore --no-owner --role=crp_owner --exit-on-error` → `grants.sql` через `psql -c
  "SELECT set_config('crp.app_role','crp_app',false), set_config('crp.owner_role','crp_owner',false)"
  -f grants.sql` → те же проверки, что в §3.7 п.4. Печатаются число таблиц, имя последней
  миграции и счётчики строк. **Строки не печатаются.** Без `--keep` база удаляется.
- Цель = `BACKUP_DB` требует `--force-prod`. Скрипт проверяет, что приложение остановлено
  (`pm2 jlist` → нет `online`). Если запущено — отказ с подсказкой. Боевую базу не удаляет:
  `ALTER DATABASE crp RENAME TO crp_broken_<ts>`, затем восстановление в `crp`. Порядок
  действий — RUNBOOK §6.3.

### 3.9 Мониторинг: `deploy/bin/healthcheck.sh` (крон каждые 5 минут, от `crp`)

Проверки. Каждая даёт `ok`, `warn` или `fail`, результат пишется в
`/var/lib/crp-ops/monitor-state.json`:

| Проверка | Порог |
|---|---|
| `GET 127.0.0.1:$port/api/health` | `status=ok`, ответ < 5 с |
| PM2: процесс `online`, рост `restart_time` | fail, если процесс не `online`; warn, если +3 рестарта за час |
| Свежесть бэкапа (`backup-status.json`) | `ok=true` и `at` моложе 26 ч; файлы — моложе 26 ч, если `STORAGE_DIR` не пуст |
| Свободное место на `/`, `/var/backups`, `STORAGE_DIR` | warn < 20 %, fail < 10 % |
| Срок сертификата TLS (`openssl x509 -enddate`) | warn < 21 дня, fail < 7 дней |
| Внешний взгляд | `curl -fsS https://$DOMAIN/api/health` — проверяет DNS, TLS и nginx |

Алерт отправляется **только при смене состояния** (ok→fail, fail→ok), чтобы не спамить. Канал
задаёт `monitor.env`:
- `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` — после решения владельца;
- иначе `logger -t crp-alert` (journald) и строка в `/var/log/crp/healthcheck.log`.

Текст алерта: имя проверки, имя экземпляра (`crp`) и время. **Без IP, ПДн и текста ошибок.**

Внешний uptime-монитор раз в минуту дёргает `https://<domain>/api/health`. ПДн он не получает.
Это вопрос владельцу (§9): по умолчанию не подключаем.

### 3.10 `deploy/cron/crp.cron` → `/etc/cron.d/crp`

Время сервера — UTC: так проще с логами и epoch-мс. `CRON_TZ` не используем, потому что
Debian/Ubuntu cron его не поддерживает надёжно. В комментариях — время Астаны (UTC+5).

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
# Бэкап БД 02:30 Астаны; в воскресенье — с полной проверкой восстановления
30 21 * * 0-5  postgres /usr/local/lib/crp/backup.sh                  >> /var/log/crp/backup.log 2>&1
30 21 * * 6    postgres /usr/local/lib/crp/backup.sh --verify-restore >> /var/log/crp/backup.log 2>&1
# Бэкап загруженных файлов 03:00 Астаны
0 22 * * *     crp /usr/local/lib/crp/backup.sh --files               >> /var/log/crp/backup-files.log 2>&1
# Очередь писем (mail-account.md): раз в минуту; при выключенных флагах — выход с кодом 0
* * * * *      crp /usr/local/lib/crp/run-script.sh mail-worker       >> /var/log/crp/mail.log 2>&1
# Напоминания о сроках: 09:00–19:00 Астаны = 04:00–14:00 UTC
0 4-14 * * *   crp /usr/local/lib/crp/run-script.sh send-reminders    >> /var/log/crp/reminders.log 2>&1
# Чистка файлов (uploads.md) 04:00 Астаны
0 23 * * *     crp /usr/local/lib/crp/run-script.sh files-sweep       >> /var/log/crp/files-sweep.log 2>&1
# Мониторинг
*/5 * * * *    crp /usr/local/lib/crp/healthcheck.sh                  >> /var/log/crp/healthcheck.log 2>&1
```

`run-script.sh <name> [-- args]`:
- имя по шаблону `^[a-z0-9-]+$`, файл `{{ROOT}}/current/scripts/<name>.ts` должен существовать.
  Если файла нет, скрипт пишет «нет в этом релизе» и выходит с кодом 0: крон ставится заранее,
  а скрипт приходит со своим релизом;
- `flock -n /run/lock/crp-<name>.lock` — без наложений;
- `cd current && NODE_ENV=production timeout 15m node --env-file=/etc/crp/app.env --import tsx
  scripts/<name>.ts "$@"`;
- флаги функций (`REMINDERS` и др.) проверяет сам скрипт и при выключенном флаге выходит с
  кодом 0.

### 3.11 Переменные окружения (шаблоны в `deploy/env/*.example`, значения — только на сервере)

`/etc/crp/app.env` — приложение и крон (`crp_app`):

| Переменная | Прод-значение / правило |
|---|---|
| `DATABASE_URL` | `postgres://crp_app:<пароль>@127.0.0.1:5432/crp?sslmode=require` |
| `DB_POOL_MAX` | `10` |
| `DB_MIGRATE_ON_START` | `0`. Пусто — тоже 0 в production; preflight ругается на `1` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | `openssl rand -base64 32`, один на все релизы |
| `NEXT_PUBLIC_SITE_URL` | `https://<домен>` (вшивается при сборке) |
| `TRUSTED_PROXY_HOPS` | `1` |
| `TRUST_X_REAL_IP` | пусто |
| `DEMO_MODE`, `SEED_DEMO`, `PGLITE_DIR` | пусто (preflight: ошибка, если заданы) |
| `NEXT_TELEMETRY_DISABLED` | `1`. Телеметрия Next уходит за рубеж |
| `FEATURE_PASSWORD_RESET`, `FEATURE_EMAIL_VERIFY`, `FEATURE_REMINDERS`, `FEATURE_UPLOADS`, `FEATURE_LEGAL`, `FEATURE_CERT_PDF` | `0`, пока функция не прошла приёмку |
| `MAIL_*`, `SMTP_*` | из `mail-account.md`; `MAIL_TRANSPORT=outbox`, пока ЦРП не выбрал почту |
| `STORAGE_DIR`, `UPLOAD_*` | из `uploads.md`; `STORAGE_DIR=/var/lib/crp/files` |

`/etc/crp/migrate.env`: `DATABASE_URL=postgres://crp_owner:<пароль>@127.0.0.1:5432/crp?sslmode=require`,
`MIGRATE_LOCK_TIMEOUT_MS=5000`, `DB_APP_ROLE=crp_app`, `DB_OWNER_ROLE=crp_owner`.

`/etc/crp/backup.env`: `BACKUP_DB=crp`, `BACKUP_DIR=/var/backups/crp`,
`BACKUP_AGE_RECIPIENTS_FILE=/etc/crp/backup-recipients.txt`, `BACKUP_KEEP_DAILY=14`,
`BACKUP_KEEP_WEEKLY=8`, `BACKUP_KEEP_MONTHLY=6`, `BACKUP_REMOTE=` (пусто до решения),
`STORAGE_DIR=/var/lib/crp/files`.

`/etc/crp/monitor.env`: `DOMAIN=`, `ALERT_TELEGRAM_BOT_TOKEN=`, `ALERT_TELEGRAM_CHAT_ID=`.

`NODE_ENV` в env-файлы **не пишем**: его задают PM2 (`env`), `run-script.sh` и `deploy.sh`.
Next предупреждает, если `NODE_ENV` пришёл из `.env`.

### 3.12 `docs/ops/RUNBOOK.md` — содержание по разделам

1. **Схема.** Каталоги и пользователи (§3.1), путь запроса: клиент → nginx:443 →
   127.0.0.1:3000 (PM2 cluster ×1) → Postgres 127.0.0.1:5432 (SSL). Где лежат секреты (`/etc/crp`)
   и что в репозитории их нет.
2. **Установка сервера с нуля.** Порядок:
   - Ubuntu 24.04 LTS, `timedatectl set-timezone UTC`, `systemd-timesyncd`;
   - SSH только по ключам, `PermitRootLogin no`, `ufw allow 22,80,443`, `fail2ban` для sshd,
     `unattended-upgrades` (security), swap 2 ГБ;
   - Node 22 из NodeSource; `npm i -g pm2@<точная версия>`;
   - `apt install postgresql-16` → `crp.conf`, `pg_hba` → `roles.sql` → `\password`;
   - nginx, certbot, `age`, `rsync`, `jq`;
   - пользователи `crp` и `crpdeploy`, каталоги и права;
   - `git clone --mirror` в `repo.git`, файлы `/etc/crp/*.env` по шаблонам;
   - `install-ops.sh --domain …`;
   - первая выкладка `deploy.sh vX.Y.Z`;
   - `pm2 startup systemd -u crp` + `pm2 save`;
   - первый админ (п. 3), первый бэкап и учебное восстановление (п. 6.2).
3. **Первый администратор.** `sudo -u crp /usr/local/lib/crp/run-script.sh create-admin --
   --email … --name … --owner-org-name "ЦРП" --owner-org-slug crp`. Пароль вводится в
   приглашении, не в командной строке. Демо-данных на проде нет: preflight проверяет, что нет
   `@crp.demo`.
4. **Выкладка.** Тег ставится на `main` после зелёного CI. Затем `deploy.sh vX.Y.Z`. Что
   значат коды выхода. Как читать `deploy.log`. Ассеты старых страниц продолжают отдаваться.
5. **Миграции.** Только добавляющие и идемпотентные. Удаление колонки или таблицы — в два
   релиза: сначала код перестаёт её использовать, потом отдельная миграция по решению
   architect. `CREATE INDEX` на большой таблице — с учётом `lock_timeout`. Что делать, если
   миграция упала (прод не тронут, чиним, новый тег). Почему откат не трогает БД.
6. **Бэкапы и восстановление.**
   - 6.1 Что, когда и где лежит; где копия в РК; у кого ключ.
   - 6.2 Учебное восстановление раз в месяц (чек-лист): `restore.sh` в `crp_restore_*`,
     сравнение счётчиков, удаление, запись даты в журнал учений вне репозитория.
   - 6.3 Авария: `pm2 stop crp` → `restore.sh --target crp --force-prod` →
     `db-migrate` (если код новее дампа) → `db-grants` → `pm2 start` → health. Потерянные
     с момента бэкапа оплаты восстанавливаются по банковской выписке, «Оплачено» ставится
     заново.
   - 6.4 Сервер погиб: новый сервер по разделу 2 + `/etc/crp` из менеджера паролей владельца +
     последний бэкап + ключ age.
7. **Логи.** `/var/log/crp/*` (PM2, крон) и `/var/log/nginx/crp.*`, ротация 14 дней. В логах
   nginx нет query и Referer. **Логи с прода не вставлять в ИИ-сессии** (AGENTS.md): для
   разбора — обезличенная выдержка.
8. **Мониторинг.** Таблица проверок §3.9 и что делать по каждому алерту.
9. **Секреты.** Список, где лежат и как менять:
   - `SESSION_SECRET` — смена выкидывает всех из системы;
   - пароли ролей — `\password`, правка env, `pm2 reload`;
   - ключ age — перешифровывать старые бэкапы не нужно, новые идут на новый ключ, старый
     ключ хранится до истечения ротации.
10. **Стейдж и приёмка #24** — чек-лист §7.4.
11. **Инциденты.**
    - 502 и страница обслуживания: процесс упал → `pm2 logs`;
    - health=fail и `migrations=pending`: выложили без миграций → `db-migrate`;
    - диск заполнен;
    - Postgres не стартует;
    - истёк сертификат;
    - цикл рестартов: `max_memory_restart`, логи.
12. **Нельзя.**
    - подменять `.next` на месте и править файлы в `releases/` руками;
    - `pm2 restart` вместо `startOrReload`;
    - `DEMO_MODE` и `SEED_DEMO` на проде;
    - копия бэкапа за пределами РК;
    - ПДн в ИИ-сессиях;
    - IP, пароли и ключи в репозитории, issue и PR.

### 3.13 Слой БД (правки в зоне foundation, ревью architect)

`src/lib/db/migrate.ts` — добавить:

```ts
export type MigrationStatus = {
  files: string[];     // на диске, по алфавиту
  applied: string[];   // в schema_migrations
  pending: string[];   // на диске, но не накатаны
  unknown: string[];   // накатаны, но файла нет (БД новее кода — норма после отката)
};
/** Чистая функция: сравнение списков (unit-тест). */
export function diffMigrations(files: string[], applied: string[]): MigrationStatus;
/** Только SELECT: работает от роли приложения. Нет таблицы schema_migrations — всё pending. */
export async function migrationStatus(db: Pick<Db, 'sql'>, dir?: string): Promise<MigrationStatus>;
export class MigrationsPendingError extends Error { readonly pending: string[]; }
export async function assertMigrated(db: Pick<Db, 'sql'>, dir?: string): Promise<void>;
// migrate(db, dir, opts?: { lockTimeoutMs?: number }) — после advisory-блокировки:
//   SELECT set_config('lock_timeout', ${String(ms)}, true)   (значение параметром, без склейки)
```

Таблица ищется через `SELECT to_regclass('schema_migrations') IS NOT NULL AS ok` — это работает
в обоих драйверах.

`src/lib/db/index.ts` — добавить и использовать в `init()`:

```ts
/** Накатывать миграции при старте: демо, разработка и тесты — да; production — нет (только проверка). */
export function autoMigrateEnabled(env?: NodeJS.ProcessEnv): boolean;
/** Подготовка открытого драйвера: migrate или assertMigrated, затем сид (как сейчас). Для скриптов и тестов. */
export async function prepareDb(db: DbHandle, opts?: { autoMigrate?: boolean; seed?: boolean }): Promise<void>;
```

`init()` = `openDriver()` → `prepareDb(db)`. При ошибке инициализации `g.__crpDb` уже
сбрасывается, поэтому после `db-migrate` процесс поднимется со следующего запроса, без
рестарта.

`scripts/db-migrate.ts`:
- `--status` печатает `applied=N pending=M unknown=K` и имена pending. Код выхода: 0 — всё
  накатано, 3 — есть pending, 1 — ошибка;
- без флага — `migrate(db, undefined, { lockTimeoutMs: Number(MIGRATE_LOCK_TIMEOUT_MS) || 5000 })`.

`scripts/db-grants.ts`:
- открывает драйвер по `DATABASE_URL` (owner);
- проверяет имена `DB_APP_ROLE` и `DB_OWNER_ROLE` по шаблону `^[a-z_][a-z0-9_]{0,62}$`;
- в одной транзакции выполняет `SELECT set_config('crp.app_role', ${app}, true),
  set_config('crp.owner_role', ${owner}, true)`, затем `exec(readFile('deploy/postgres/grants.sql'))`.
  Это тот же приём, что у миграций: `exec` только для файла из репозитория;
- на PGlite выходит с сообщением «роли — только на Postgres» и кодом 0.

### 3.14 Проверка здоровья: `GET /api/health`

`src/lib/ops/release.ts`:
```ts
export type ReleaseInfo = { id: string; tag: string | null; sha: string | null; builtAt: number | null };
/** RELEASE.json из process.cwd() (кэш на процесс); иначе VERCEL_GIT_COMMIT_SHA / COMMIT_REF (Netlify); иначе id='dev'. */
export function readRelease(cwd?: string, env?: NodeJS.ProcessEnv): ReleaseInfo;
export function parseRelease(json: unknown): ReleaseInfo | null;   // zod, чистая
```

`src/lib/ops/health.ts`:
```ts
export type HealthReport = {
  status: 'ok' | 'fail';
  release: string; sha: string | null;
  mode: 'production' | 'demo';
  checks: { db: 'ok' | 'fail'; migrations: 'ok' | 'pending' | 'unknown' };
  pendingCount: number;
  time: number;            // epoch-мс
};
/** getDb() + SELECT 1 + migrationStatus с общим таймаутом 3 с. Тексты ошибок наружу не идут. */
export async function getHealth(deps?: { getDb?: () => Promise<Db>; timeoutMs?: number; release?: ReleaseInfo }): Promise<HealthReport>;
```

Логика проверок:
- `getDb()` бросил `MigrationsPendingError` → `db='ok'`, `migrations='pending'`,
  `pendingCount=e.pending.length`;
- любая другая ошибка или таймаут → `db='fail'`, `migrations='unknown'`;
- `status='ok'` ⇔ `db='ok'` и `migrations='ok'`;
- ошибка пишется в `console.error` одной строкой с кодом (`e.code`), **без** текста запроса и
  параметров.

`src/app/api/health/route.ts`:
```ts
export const dynamic = 'force-dynamic';
export async function GET(): Promise<Response>;
// 200 при ok, 503 при fail; Content-Type: application/json; Cache-Control: no-store; X-Robots-Tag: noindex
```

- Доступ публичный: нужен nginx, deploy.sh и монитору. Ответ не содержит ПДн, имён таблиц,
  текстов ошибок и хостов. `release`/`sha` не секрет: репозиторий публичный.
- Частота ограничена nginx (`crp_health`, 2 r/s, всплеск до 10).
- `src/proxy.ts` уже исключает `/api` из локализации, правка не нужна.
- **Отступление от BUILD §6** («route handlers — только для файлов»): оркестратору добавить
  исключение `/api/health` (§8.4).

### 3.15 Проверка окружения: `scripts/ops-preflight.ts [--db]`

`src/lib/ops/preflight.ts`:
```ts
export type PreflightIssue = { level: 'error' | 'warn'; code: string };   // без значений переменных
/** Чистая функция от env (unit-тесты). */
export function checkProductionEnv(env: NodeJS.ProcessEnv): PreflightIssue[];
/** Проверки через БД от роли приложения. */
export async function checkProductionDb(db: Pick<Db, 'sql'>): Promise<PreflightIssue[]>;
```

Правила `checkProductionEnv` — уровень `error`:
- `demo_mode_set` — `DEMO_MODE=1`;
- `seed_demo_set` — `SEED_DEMO=1`;
- `pglite_dir_set` — задан `PGLITE_DIR`;
- `database_url_missing`, `database_url_not_postgres`;
- `database_url_no_ssl` — нет `sslmode=require|verify-ca|verify-full`;
- `database_url_privileged_user` — пользователь `postgres` или `DB_OWNER_ROLE`/`crp_owner`;
- `session_secret_weak` — `SESSION_SECRET` < 32 символов;
- `site_url_not_https` — `NEXT_PUBLIC_SITE_URL` не `https://`;
- `proxy_hops_not_1` — `TRUSTED_PROXY_HOPS` ≠ 1. За nginx на этом сервере должно быть ровно
  1; если появится CDN, правило меняют вместе с nginx;
- `trust_x_real_ip_set` — `TRUST_X_REAL_IP=1` при hops=1;
- `auto_migrate_on` — `DB_MIGRATE_ON_START=1`.

Уровень `warn`:
- `server_actions_key_missing` — нет `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`;
- `telemetry_on` — `NEXT_TELEMETRY_DISABLED` ≠ 1;
- `feature_on:<NAME>` — флаг включён: напоминание, что функция должна пройти приёмку.

Правила `checkProductionDb`:
- `db_superuser` (error) — `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
- `db_can_create` (error) — `has_schema_privilege(current_user, current_schema(), 'CREATE')`;
- `demo_users_present` (error) — `SELECT count(*) FROM users WHERE email LIKE '%@crp.demo'`.
  Таблицы нет — пропуск: это первая выкладка до миграций.

Вывод: `ERROR <code>` / `WARN <code>` по строке, без значений. Код выхода 1, если есть `error`.

### 3.16 Первый администратор: `scripts/create-admin.ts`

```
create-admin --email <e> --name <n> [--locale ru|kz] [--promote]
             [--owner-org-name <name> --owner-org-slug <slug>] [--password-stdin] [--allow-demo]
```

`src/lib/ops/createAdmin.ts`:
```ts
export type CreateAdminInput = {
  email: string; name: string; locale: 'ru' | 'kz'; password?: string;   // без password — только --promote
  promote: boolean; ownerOrg?: { name: string; slug: string };
};
export type CreateAdminResult = {
  userId: string; created: boolean; promoted: boolean; orgId: string | null; orgCreated: boolean;
};
export class CreateAdminError extends Error { readonly code: 'validation' | 'weak_password' | 'exists' | 'not_found' | 'bad_slug'; }
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export async function createAdmin(db: Db, input: CreateAdminInput): Promise<CreateAdminResult>;
```

- Email приводится к виду `normalizeEmail` из `src/lib/auth` и проверяется той же zod-схемой,
  что при регистрации. Имя — 1–100 символов. Пароль: `passwordProblem` + не короче 12 символов
  для админа. Хэш — `hashPassword` (bcryptjs, cost 10).
- Одна транзакция:
  - `INSERT … ON CONFLICT (email) DO NOTHING RETURNING id` с `role='admin'` и
    `email_verified_at=now()`: адрес ввёл оператор;
  - конфликт без `--promote` → `exists`. Конфликт с `--promote` → `UPDATE users SET
    role='admin'`. Пароль и сессии не меняются;
  - `--promote` без существующего пользователя → `not_found`;
  - организация-владелец: если нет строки `kind='owner'`, создаётся (`slug` по `^[a-z0-9-]{2,40}$`).
    Админ добавляется в неё как `manager` (`ON CONFLICT DO NOTHING`). Если владелец уже есть,
    берётся он, второй не создаётся;
  - аудит (`actor_id NULL`, `meta {via:'cli'}`, email в `meta` **не** пишется):
    `user.create_admin`, `user.promote_admin`, `org.create`, `org.member_add`.
    Вставка своя, в `src/lib/ops`: `writeAudit` из зоны admin требует `actorId: string`.
- CLI:
  - пароль спрашивается дважды без эха (`readline` с подавлением вывода);
  - `--password-stdin` читает одну строку (для автоматизации);
  - в argv пароль **не принимается**: он виден в `ps` и истории shell;
  - `isDemo()` → отказ с кодом 2, если нет `--allow-demo`: в демо админ есть в сиде;
  - сначала `assertMigrated(db)`: работает от `crp_app`;
  - коды выхода: 0 — успех, 2 — validation/weak_password/bad_slug/демо, 3 — exists/not_found,
    1 — прочее;
  - вывод: «Администратор создан» или «Роль admin выдана», плюс id. Email не печатается
    повторно.
- Сообщения CLI — для оператора, а не для пользователя платформы, поэтому в `messages/*` не
  выносятся. Пишутся по-русски.
- Позже, когда включат `PASSWORD_RESET` (`mail-account.md`), добавится `--invite`: админ без
  пароля + письмо со ссылкой установки. Это follow-up, не часть ops.1.

---

## 4. Сценарии и экраны

### 4.1 Оператор (SalemAI или ИТ ЦРП)

- **Выкладка:** `git tag v0.3.0 && git push --tags` (через PR-процесс) → на сервере
  `sudo -u crpdeploy /usr/local/lib/crp/deploy.sh v0.3.0`. За 3–6 минут сборки пользователи
  ничего не замечают. Открытые страницы при следующей навигации получают полную перезагрузку
  (`NEXT_DEPLOYMENT_ID`).
- **Откат:** `sudo -u crpdeploy /usr/local/lib/crp/rollback.sh`, около 20 с.
- **Учебное восстановление:** раз в месяц по чек-листу RUNBOOK §6.2.
- **Первый вход:** `create-admin` → вход в `/ru/login` → админка пустая, демо-курсов нет.
  Курсы создаются в конструкторе.

### 4.2 Пользователь платформы

Новых экранов в приложении нет. Пользователь видит только:
- страницу обслуживания, если процесс недоступен (nginx 502/504). При обычной выкладке её не
  бывает;
- полную перезагрузку страницы при переходе после выкладки.

### 4.3 `deploy/nginx/maintenance.html`

Статичный файл. Приложение в этот момент не отвечает, поэтому next-intl недоступен. Это
единственное исключение из правила «тексты только в `messages/`»: оформить его в BUILD §8 (§8.4).
Inline-CSS по BRAND: фон `#F3F4F1`, текст `#14161B`, Onest/system-ui. Без внешних ресурсов,
без декора: только логотип текстом, заголовок и строка на двух языках.

| Ключ (атрибут `data-key` для теста паритета) | ru | kz (пометка «требует проверки носителем», #13) |
|---|---|---|
| `title` | Платформа обучения ЦРП временно недоступна | ЦРП оқу платформасы уақытша қолжетімсіз |
| `body` | Идут технические работы. Обновите страницу через несколько минут. | Техникалық жұмыстар жүріп жатыр. Бірнеше минуттан кейін бетті жаңартыңыз. |

`<html lang="ru">`. Казахский блок — `<section lang="kk">` (D-002).

**Ключей в `messages/{ru,kz}/*.json` ops не добавляет.** `/api/health` отдаёт машинный JSON,
без локализации.

---

## 5. Безопасность и угрозы

| # | Угроза | Как закрыта |
|---|---|---|
| 1 | Секреты, IP, доступы попали в публичный репозиторий | В `deploy/` только шаблоны с пустыми значениями. Файлы с секретами — `/etc/crp/*` на сервере. Unit-тест сканирует `deploy/**` и `docs/ops/**`: публичные IPv4 (кроме 127.0.0.1/0.0.0.0), `BEGIN … PRIVATE KEY`, `postgres://…:<непустой пароль>@`, `AGE-SECRET-KEY-` |
| 2 | Подделка IP клиента в обход лимитов D-018/D-022 | nginx **перезаписывает** `X-Forwarded-For` на `$remote_addr`. `TRUSTED_PROXY_HOPS=1`. Node слушает только `127.0.0.1`, ufw пропускает только 22/80/443. Preflight требует hops=1 и запрещает `TRUST_X_REAL_IP` |
| 3 | Прямой доступ к Node или Postgres | `-H 127.0.0.1`; `listen_addresses='localhost'`; `pg_hba` только `hostssl` 127.0.0.1, остальное reject |
| 4 | Подмена Host, CSRF server actions через чужой Host | `default_server` с `ssl_reject_handshake`; точный `server_name`; `X-Forwarded-Host=$host`. Проверку Origin в server actions Next делает сам |
| 5 | SQL-инъекция или RCE в приложении получает DDL и правит журнал | `crp_app` без DDL. `audit_log` только INSERT/SELECT. `schema_migrations` только SELECT. Не суперпользователь (preflight `db_superuser`, `db_can_create`). Пароль владельца лежит в `migrate.env`, процесс `crp` его не читает |
| 6 | Выкладка непроверенного кода | Только тег-потомок `main` с зелёным CI (`--skip-ci-check` пишется в лог). Скрипты эксплуатации — копии root в `/usr/local/lib/crp`. Код релиза не выполняется от root или postgres |
| 7 | Простой и расхождение версий при выкладке | Отдельный каталог релиза, атомарный симлинк, cluster reload, `NEXT_DEPLOYMENT_ID`, общий ключ server actions, общая статика. Проверка на `smokePort` до переключения |
| 8 | Миграция легла наполовину или заблокировала таблицы | Одна транзакция + advisory-блокировка (уже есть) + `lock_timeout` 5 с. Бэкап перед миграциями. Миграции только добавляющие, откат кода без отката БД |
| 9 | Прод запустился без миграций | `assertMigrated` при старте (fail closed), health → 503 `migrations=pending`, deploy не переключает |
| 10 | Кража бэкапов | age на открытые ключи, приватного ключа на сервере нет. Каталоги 0700. Копия — только в РК |
| 11 | Бэкап не восстанавливается | Ежедневно `pg_restore -l`. Еженедельно полное восстановление в `crp_restorecheck` со сверкой. Ежемесячно ручное учение с настоящим ключом |
| 12 | Токены и ключи заказов в логах | Формат лога nginx без `$args`/`$request`/`$http_referer`. `Referrer-Policy: strict-origin-when-cross-origin`. Крон-скрипты пишут только счётчики и id (mail-account.md). Health не логирует запросы |
| 13 | ПДн за рубежом | Телеметрия Next выключена. Алерты без ПДн. Внешний монитор только с решения владельца, видит лишь `/api/health`. При сборке наружу идут запросы к npm, GitHub и Google Fonts — без ПДн. Логи с прода — не в ИИ |
| 14 | DoS и большие тела запросов | `client_max_body_size` 2m (30m только `/api/uploads`). Таймауты тела и заголовков. `limit_req` 20 r/s (всплеск 60). `limit_conn` 50. Ответ 429, а не 503 |
| 15 | Демо-режим или демо-данные на проде | `assertDbConfigured` (есть). Preflight: `DEMO_MODE`, `SEED_DEMO`, `PGLITE_DIR`, пользователи `@crp.demo` → ошибка, выкладка останавливается |
| 16 | Health раскрывает внутренности | Только статусы и счётчик. Без текста ошибок, хоста, имён таблиц. Ограничение частоты в nginx |
| 17 | Сбой, который никто не заметил (многократные рестарты без алерта) | `healthcheck.sh`: рестарты, свежесть бэкапа, диск, сертификат, внешний HTTPS; алерт при смене состояния |
| 18 | Наложение крон-задач, зависшие задачи | `flock -n` + `timeout 15m` в `run-script.sh` |
| 19 | Эскалация `crpdeploy` → root | sudoers: только `pm2` от `crp` и `backup.sh --label pre-deploy-*` от postgres. Скрипты в `/usr/local/lib/crp` принадлежат root |
| 20 | Подмена зависимостей при сборке | `npm ci` строго по lock-файлу, версии закреплены (BUILD §1). Проверить на стейдже `--ignore-scripts`; если сборка проходит — включить |
| 21 | Пароль админа в истории shell или в `ps` | `create-admin` не принимает пароль аргументом: приглашение без эха или stdin |
| 22 | Clickjacking, XSS со сторонних источников | `X-Frame-Options DENY` + `frame-ancestors 'none'`. CSP разрешает внешний источник только `youtube-nocookie` во фрейме |

---

## 6. Флаг и демо-поведение

**Флага нет.** Ops — инфраструктура, а не пользовательская функция. `/api/health` нужен с
первой выкладки, скрипты — только CLI. Правило «новые функции за флагом» соблюдается так:
- крон запускается всегда, но каждый скрипт сам проверяет свой флаг (`REMINDERS`,
  `EMAIL_VERIFY`/`PASSWORD_RESET` для очереди писем, `UPLOADS` для `files-sweep` и
  `backup --files`) и при выключенном флаге выходит с кодом 0;
- `app.env.example` задаёт все `FEATURE_*=0`. Preflight предупреждает (`warn`) о каждом
  включённом флаге.

Демо (PGlite, Vercel/Netlify, `DEMO_MODE=1`):
- `/api/health` работает: `mode='demo'`. Миграции накатывает сам `getDb()`
  (`autoMigrateEnabled` → true), поэтому `migrations='ok'`. `release` берётся из
  `VERCEL_GIT_COMMIT_SHA` или `COMMIT_REF`, иначе `'dev'`;
- `deploy/` в демо не используется. На Vercel/Netlify ничего не меняется: `NEXT_DEPLOYMENT_ID`
  и ключ server actions там не задаются, платформа управляет версиями сама;
- `create-admin` в демо отказывает без `--allow-demo`;
- `ops-preflight` в демо намеренно выдаёт `ERROR demo_mode_set`: он только для прода;
- `db-grants` на PGlite ничего не делает (код 0).

---

## 7. Тесты

### 7.1 Unit (`tests/unit/`, node:test + tsx, без БД)

- `ops-migrations-diff.test.ts` — `diffMigrations`:
  - пусто/пусто;
  - всё накатано;
  - pending в середине алфавита;
  - unknown (БД новее);
  - дубликаты не размножаются.
- `ops-auto-migrate.test.ts` — матрица `autoMigrateEnabled`:
  - `NODE_ENV=production` + `DATABASE_URL` → false;
  - то же + `DB_MIGRATE_ON_START=1` → true;
  - `DEMO_MODE=1` → true;
  - `NODE_ENV=test` → true;
  - `DB_MIGRATE_ON_START=0` при разработке → false;
  - `VERCEL=1` без `DATABASE_URL` → true.
- `ops-release.test.ts` — `parseRelease`: валидный объект; лишние поля; плохой sha; не-JSON →
  null; `readRelease` с временным каталогом; запасные варианты из `VERCEL_GIT_COMMIT_SHA` и
  `COMMIT_REF`; `'dev'`.
- `ops-preflight.test.ts` — каждое правило `checkProductionEnv` срабатывает отдельно. Чистое
  прод-окружение → 0 ошибок. Вывод не содержит значений: подставить секрет-маркер и проверить,
  что его нет в `JSON.stringify(issues)`.
- `ops-deploy-files.test.ts` — статическая проверка файлов `deploy/`:
  - ecosystem: `exec_mode:'cluster'`, `instances:1`, `-H 127.0.0.1`. Тест делает `require` с
    фиктивным `instance.json` во временном корне;
  - nginx: есть `proxy_set_header X-Forwarded-For $remote_addr`, `log_format` без `$request `,
    `$args`, `$query_string`, `$http_referer`; есть `limit_req_status 429`, `client_max_body_size
    2m`, `ssl_reject_handshake on`; есть `/_next/static/` с `root`;
  - заголовки безопасности: HSTS, CSP с `frame-ancestors 'none'`;
  - каждый `deploy/bin/*.sh` начинается с `set -euo pipefail` и проходит `bash -n`;
    `shellcheck`, если он установлен (иначе skip);
  - cron: все пути — `/usr/local/lib/crp/`, у каждой строки пользователь `crp` или `postgres`;
  - ключи `deploy/env/app.env.example` ⊆ ключей `.env.example` (кроме явного списка ops-only);
  - `maintenance.html`: `data-key` ru и kz совпадают, есть `lang="kk"`, нет внешних URL.
- `ops-no-secrets.test.ts` — сканирование `deploy/**`, `docs/ops/**` (угроза 1).
- `ops-scripts.test.ts` — `deploy.sh`/`rollback.sh` во временном `CRP_ROOT` с шимами в `PATH`
  (`git`, `npm`, `node`, `curl`, `pm2`, `sudo`, `rsync` — bash-заглушки из
  `tests/fixtures/ops-shims/`, пишут вызовы в файл):
  - успешная выкладка: новый каталог, `RELEASE.json`, симлинк `current`, записан `previous`,
    порядок вызовов preflight → build → status → migrate → grants → smoke → reload → health;
  - preflight с `ERROR` → код 2, `current` не изменился, reload не вызывался;
  - smoke провален → код 2, симлинк не тронут;
  - health после reload провален → код 1, `current` указывает на прежний релиз, reload вызван
    дважды;
  - `rollback.sh` без аргументов → предыдущий релиз; второй вызов → обратно;
  - хранение 5 релизов: старые удалены, `current` и `previous` остались; файл статики старого
    релиза удалён, файл живого — нет;
  - второй параллельный запуск → код 4 (flock);
  - тег не по шаблону → отказ до `git`.

  На macOS/без bash тест пропускается (`skip`), в CI (ubuntu) идёт.

### 7.2 Integration (`tests/integration/`, PGlite и Postgres через `TEST_DATABASE_URL`)

- `ops-migration-status.test.ts`:
  - свежая БД без `schema_migrations` → все pending, `assertMigrated` бросает
    `MigrationsPendingError` со списком;
  - после `migrate` → pending пуст;
  - временный каталог-копия `migrations/` + лишний файл `2099-01-01-x.sql` → pending=[x];
  - удалённый файл → unknown, `assertMigrated` не бросает;
  - `prepareDb(db, {autoMigrate:false})` на пустой БД бросает, на накатанной — нет;
    `prepareDb(db, {autoMigrate:true})` накатывает;
  - `migrate(…, {lockTimeoutMs: 1234})` → внутри транзакции `current_setting('lock_timeout')`
    = `1234ms` (проверка через миграцию-фикстуру, которая пишет значение в таблицу).
- `ops-health.test.ts`:
  - `getHealth` с зарегистрированной тестовой БД → `ok`;
  - `getDb`, бросающий `MigrationsPendingError` → `fail`/`pending`/`pendingCount`;
  - `getDb`, бросающий произвольную ошибку с «секретным» текстом → `db='fail'`, текста нет в
    JSON;
  - зависший `getDb` → таймаут → `fail` не позже `timeoutMs` + 200 мс;
  - вызов `GET()` из `route.ts` → 200/503, `Cache-Control: no-store`.
- `ops-create-admin.test.ts`:
  - создаёт админа: `role=admin`, `email_verified_at` задан, хэш проверяется `verifyPassword`;
  - email нормализуется;
  - повтор → `exists`; `--promote` существующего learner → admin, `password_hash` не изменился;
  - promote несуществующего → `not_found`;
  - пароль из 11 символов → `weak_password`;
  - организация-владелец создаётся один раз, при втором вызове переиспользуется (одна строка
    `kind='owner'`), админ — `manager`;
  - аудит: 1–4 строки с `actor_id NULL`, email в `meta` нет;
  - на БД с сидом — организация ЦРП из сида переиспользуется.
- `ops-preflight-db.test.ts`:
  - на БД с сидом → `demo_users_present`;
  - на пустой (после migrate) → нет `demo_users_present`;
  - на PGlite `db_superuser` не проверяется (skip, если `driver==='pglite'`).
- `ops-grants.test.ts` — **только Postgres** (без `TEST_DATABASE_URL` — skip):
  - в CI создаются роли `crp_app_t` и `crp_owner_t` (NOLOGIN, идемпотентно);
  - тестовая схема, `migrate`, `grants.sql` с `set_config` на эти роли;
  - затем `SET ROLE crp_app_t`:
    - SELECT/INSERT/UPDATE/DELETE на `courses` проходят;
    - `INSERT audit_log` проходит, `UPDATE`/`DELETE audit_log` → 42501;
    - `INSERT schema_migrations` → 42501, `CREATE TABLE` → 42501;
    - `migrationStatus` работает, `migrate()` падает с 42501;
  - повторный прогон `grants.sql` не падает (идемпотентность);
  - таблица, созданная после `ALTER DEFAULT PRIVILEGES` от `crp_owner_t`, сразу доступна
    `crp_app_t`.
  - CI-пользователь `crp` в `postgres:16` — суперпользователь, поэтому `SET ROLE` доступен.

### 7.3 E2E (`tests/e2e/`, Playwright, `next start` в демо)

- `ops-health.spec.ts`:
  - `request.get('/api/health')` → 200, `status:'ok'`, `mode:'demo'`,
    `checks.migrations:'ok'`;
  - заголовок `cache-control` содержит `no-store`;
  - путь не перенаправляется на `/ru/...`;
  - в теле нет `postgres`, `password`, `@`.

### 7.4 Приёмка на стейдже (ручная, чек-лист в RUNBOOK §10; условие «готово» из #24)

Стейдж: `instance.json` с `name=crp-staging`, `port=3001`, `configDir=/etc/crp-staging`, БД
`crp_staging` с ролями `crp_staging_owner`/`crp_staging_app`. Только синтетические данные.

1. Установка с нуля по RUNBOOK §2 — без шагов, которых нет в документе.
2. `deploy.sh vA` → `create-admin` → вход → создать курс.
3. Под нагрузкой (`while :; do curl -s -o /dev/null -w '%{http_code}\n' https://staging…/ru; done
   | sort | uniq -c` в двух терминалах) выполнить `deploy.sh vB` с новой миграцией → **ноль**
   ответов 5xx. `/api/health` показывает vB. Открытая до выкладки вкладка после перехода
   перезагружается и работает.
4. `rollback.sh` → vA работает с новой схемой, ноль 5xx.
5. Сломанный релиз (тег с падающей сборкой или health) → прод не тронут (код 2) / автооткат
   (код 1).
6. `backup.sh --verify-restore` → статус ok. `restore.sh` с настоящим ключом в
   `crp_staging_restore_*` → счётчики совпадают.
7. Перезагрузка сервера → PM2 поднимает приложение, health ok.
8. `certbot renew --dry-run` проходит.
9. Остановить приложение → `healthcheck.sh` фиксирует fail, после старта — ok, алерт приходит
   ровно два раза.
10. Проверить, что нет `X-Powered-By`, есть CSP/HSTS. В консоли браузера нет нарушений CSP на
    страницах: каталог, урок с YouTube, тест, сертификат, админка.
11. Подделка IP: `curl -H 'X-Forwarded-For: 1.2.3.4'` → лимит входа считается по реальному IP
    (21-я неверная попытка с одного IP блокируется).

---

## 8. План реализации

### 8.1 Исполнитель A — `builder` (Sonnet), T2→T1, код приложения (зона foundation + новая `src/lib/ops`)

Файлы: `src/lib/db/{migrate,index}.ts`, `src/lib/ops/**`, `src/app/api/health/route.ts`,
`scripts/{db-migrate,db-grants,ops-preflight,create-admin}.ts`, `deploy/postgres/{roles,grants}.sql`,
`.env.example`, тесты `tests/{unit,integration,e2e}/ops-{migrations-diff,auto-migrate,release,preflight,migration-status,health,create-admin,preflight-db,grants}.*`.

Порядок:
- A1. `migrate.ts`: `diffMigrations`, `migrationStatus`, `MigrationsPendingError`,
  `assertMigrated`, `lockTimeoutMs` + unit и integration тесты.
- A2. `index.ts`: `autoMigrateEnabled`, `prepareDb`, `init()` через `prepareDb`. Прогнать **все**
  существующие тесты: поведение в демо и тестах не меняется.
- A3. `db-migrate --status`, `db-grants.ts`, `roles.sql`, `grants.sql`, `ops-grants.test.ts` (CI
  Postgres).
- A4. `release.ts`, `health.ts`, `route.ts` + тесты + e2e.
- A5. `preflight.ts` + `ops-preflight.ts` + тесты.
- A6. `createAdmin.ts` + `create-admin.ts` + тесты.
- A7. `.env.example`: новые переменные с комментариями.

Проверки: `typecheck`, `lint`, `test:unit`, `test:integration` (PGlite и Postgres), `build`
(`DEMO_MODE=1`), `test:e2e`.

### 8.2 Исполнитель B — `builder` (Sonnet), T1, комплект выкладки (новая зона `deploy/`, `docs/ops/`)

Файлы: `deploy/**`, кроме `deploy/postgres/{roles,grants}.sql`; `docs/ops/RUNBOOK.md`;
`tests/unit/ops-{deploy-files,no-secrets,scripts}.test.ts`; `tests/fixtures/ops-shims/**`.

Порядок:
- B1. `lib.sh`, `deploy.sh`, `rollback.sh` + шимы + `ops-scripts.test.ts`.
- B2. `ecosystem.config.cjs`, nginx-шаблон, заголовки, `maintenance.html`.
- B3. `backup.sh`, `restore.sh`, `run-script.sh`, `healthcheck.sh`, `install-ops.sh`, cron,
  logrotate, sudoers, конфиги Postgres, `deploy/env/*.example`.
- B4. `ops-deploy-files.test.ts`, `ops-no-secrets.test.ts`.
- B5. `docs/ops/RUNBOOK.md` по §3.12, `deploy/README.md`.

Проверки: `test:unit`, `bash -n`, `shellcheck` (если есть локально).

### 8.3 Стыки A ↔ B (фиксированы этим документом, менять только через architect)

- `scripts/db-migrate.ts --status`: коды 0/3/1. `scripts/ops-preflight.ts`: код 1 при ERROR,
  вывод `ERROR|WARN <code>`. `create-admin`: коды 0/2/3/1.
- `RELEASE.json` = `{id, tag, sha, builtAt}` в корне релиза; health читает его из
  `process.cwd()`.
- Health JSON — §3.14; deploy.sh проверяет `status=="ok"` и `release==$id` через `jq`.
- `db-grants.ts` читает `deploy/postgres/grants.sql` (файл A), `restore.sh` (B) вызывает тот же
  файл через `psql`.
- Порт проверки до переключения — `instance.json.smokePort` (по умолчанию 3109; 3100 занят e2e
  локально).

A и B не пересекаются по файлам и работают параллельно. Заглушки для тестов B не нужны: шимы
подменяют `node`/`npm`.

### 8.4 Оркестратор (общие файлы, отдельными коммитами)

- **`DECISIONS.md`** — перенесено: выкладка — D-027, роли БД — D-026, бэкапы — D-029 (предложено,
  ждёт владельца), health и логи — D-028. Источник истины — там.
- **`docs/lms/BUILD.md`:**
  - §2 — «в production миграции применяет только `npm run db:migrate` при выкладке, рантайм
    проверяет (`assertMigrated`)»;
  - §6 — строка `/api/health`;
  - §8 — исключение для `maintenance.html`;
  - §11 — подраздел «Прод на сервере ЦРП» со ссылкой на RUNBOOK;
  - §12 — зоны `deploy/`, `docs/ops/`, `src/lib/ops`.
- **`package.json`** (только оркестратор):
  - `"db:status": "tsx scripts/db-migrate.ts --status"`, `"db:grants": "tsx scripts/db-grants.ts"`,
    `"ops:preflight": "tsx scripts/ops-preflight.ts"`, `"admin:create": "tsx scripts/create-admin.ts"`.
    Новых зависимостей нет;
  - в `ci.yml` добавить `sudo apt-get install -y shellcheck` (необязательно).
- **Issue в зону admin:** управление организациями и их членами в админке. Без этого «Команда»
  на чистом проде пустая.
- **Соседним проектам** (`mail-account`, `uploads`): скрипты крона вызывают `prepareDb`, а не
  `migrate` (§2.4).
- Ревью: `reviewer` (T2) — оба PR. `architect` — `grants.sql`, `migrate.ts`/`index.ts`, `deploy.sh`
  перед мержем.

### 8.5 Задачи по уровням

| Задача | Уровень | Кто |
|---|---|---|
| A1–A3: статус миграций, `prepareDb`, роли и права | T2→T1 | builder A, ревью architect |
| A4–A7: health, preflight, create-admin, `.env.example` | T1 | builder A |
| B1: deploy/rollback + тест на шимах | T2→T1 | builder B, ревью architect |
| B2–B5: nginx, PM2, бэкап, крон, RUNBOOK | T1 | builder B |
| Записи в DECISIONS, правки BUILD, package.json, issue admin | T0 (по тексту из §8.4) | оркестратор / mechanic |
| Ревью перед пушем | T2 | reviewer |
| Приёмка на стейдже (§7.4) | человек-оператор по RUNBOOK | — |

---

## 9. Открытые вопросы владельцу

1. **Хостер и сервер в РК.** ЦРП — оператор ПДн, поэтому договор лучше оформить на ЦРП.
   *Рекомендация:* VPS в дата-центре РК (кандидаты: PS Cloud Services, Hoster.kz, QazCloud —
   сравнить цену и SLA), 2 vCPU, 4 ГБ RAM, 60 ГБ SSD, Ubuntu 24.04. Кто платит и чей аккаунт?
2. **Домен.** *Рекомендация:* `learn.crp.kz`, DNS A-запись у ЦРП. Нужен доступ к DNS или
   человек со стороны ЦРП.
3. **Вторая копия бэкапов.** *Рекомендация:* второй дешёвый VPS или S3-совместимое хранилище у
   **другого** провайдера в РК. Зашифрованная копия за рубежом тоже, вероятно, считается
   трансграничной передачей (D-009, юрист). До решения — только локальная копия, и это риск
   потери данных вместе с сервером.
4. **RPO 24 часа** (ежедневный бэкап) приемлем для MVP? Оплаты за последние сутки
   восстанавливаются по выписке. *Рекомендация:* да; PITR — после запуска эквайринга (D-007,
   Фаза 1).
5. **Хранители ключа расшифровки бэкапов** (age). *Рекомендация:* двое — представитель ЦРП и
   ответственный SalemAI, ключи офлайн (менеджер паролей + бумажная копия в сейфе).
6. **Канал алертов.** *Рекомендация:* Telegram-бот в закрытый чат эксплуатации, тексты без ПДн.
   Альтернатива — почта после выбора провайдера (mail-account.md). Внешний uptime-монитор
   (например, UptimeRobot) видит только `/api/health` — подключать?
7. **Кто имеет SSH и право выкладки, кто ставит теги релизов.** *Рекомендация:* 2 человека
   SalemAI + 1 от ИТ ЦРП, у каждого своя учётка и ключ. Список хранится вне репозитория.
8. **HSTS `includeSubDomains`/preload для `crp.kz`.** Возможно, только если все поддомены ЦРП
   работают по HTTPS. *Рекомендация:* без `includeSubDomains`, пока это не проверено.
9. **Стейдж для приёмки #24.** *Рекомендация:* на том же сервере второй экземпляр
   (`crp-staging`, своя БД и роли, поддомен `staging-learn.crp.kz` под basic auth, только
   синтетические данные). Дешевле второго сервера; комплект это поддерживает (`instance.json`).
10. **Окно обслуживания** для работ с простоем (мажорное обновление Postgres, перенос сервера).
    *Рекомендация:* воскресенье 06:00–08:00 по Астане, с уведомлением за сутки.
