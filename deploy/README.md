# deploy/: комплект выкладки на сервер ЦРП

Шаблоны и скрипты эксплуатации. Порядок работы, коды выхода, бэкапы и инциденты описаны в
[docs/ops/RUNBOOK.md](../docs/ops/RUNBOOK.md). Здесь нет секретов, IP и доступов: значения в
угловых скобках вносит оператор на сервере.

| Путь | Что |
|---|---|
| `bin/deploy.sh`, `bin/rollback.sh` | выкладка релиза и откат (D-027) |
| `bin/backup.sh`, `bin/restore.sh` | бэкап и восстановление (D-029, предложено) |
| `bin/run-script.sh` | запуск `scripts/<имя>.ts` из текущего релиза по крону |
| `bin/healthcheck.sh` | мониторинг раз в 5 минут |
| `bin/install-ops.sh` | установка комплекта на сервер от root |
| `bin/lib.sh` | общие функции |
| `ecosystem.config.cjs` | PM2: cluster, один процесс |
| `nginx/` | шаблон сайта, заголовки безопасности, страница обслуживания |
| `cron/`, `logrotate/`, `sudoers/` | `/etc/cron.d/crp`, `/etc/logrotate.d/crp`, `/etc/sudoers.d/crpdeploy` |
| `env/` | шаблоны `/etc/crp/*.env` и список получателей бэкапа |
| `postgres/` | настройки сервера и `pg_hba`; `roles.sql` и `grants.sql` относятся к коду приложения |

Проверка скриптов: `npm run test:unit` (тесты `ops-deploy-files`, `ops-scripts`, `ops-no-secrets`
запускают скрипты на заглушках внешних команд из `tests/fixtures/ops-shims`).
