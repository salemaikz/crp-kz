#!/usr/bin/env bash
# Установка (и обновление) комплекта эксплуатации на сервере: от root.
#   install-ops.sh --domain <домен> [--root /srv/crp] [--port 3000] [--dry-run]
# Копирует скрипты в /usr/local/lib/crp, ставит крон, logrotate, sudoers и сайт nginx из шаблона,
# создаёт каталоги с правами. Идемпотентен: повторный запуск обновляет файлы и ничего не ломает.
# Запускать из выгрузки тега (git archive <тег> deploy), а не из каталога, который меняет crpdeploy.
# Пользователи crp и crpdeploy и пакеты создаются до запуска (RUNBOOK, раздел 2).
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SELF_DIR/.." && pwd)"

DOMAIN=""
ROOT="/srv/crp"
PORT=""
DRY=0
while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "Использование: install-ops.sh --domain <домен> [--root /srv/crp] [--port 3000] [--dry-run]" >&2; exit 2 ;;
  esac
done
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && "$DOMAIN" == *.* ]] || { echo "install-ops.sh: укажите --domain (строчные латинские буквы, цифры, точки)" >&2; exit 2; }
[[ "$ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "install-ops.sh: недопустимый --root" >&2; exit 2; }
[[ -z "$PORT" || "$PORT" =~ ^[0-9]{2,5}$ ]] || { echo "install-ops.sh: недопустимый --port" >&2; exit 2; }
if ((DRY == 0)) && [[ "$(id -u)" != 0 ]]; then echo "install-ops.sh: запускайте от root" >&2; exit 2; fi

say() { echo "install-ops: $*"; }
run() {
  if ((DRY)); then echo "+ $*"; else "$@"; fi
}
need_user() {
  if id "$1" >/dev/null 2>&1; then return 0; fi
  if ((DRY)); then say "(dry-run) нет пользователя $1"; return 0; fi
  echo "install-ops.sh: нет пользователя $1 (RUNBOOK, раздел 2)" >&2
  exit 2
}
need_user crp
need_user crpdeploy
command -v jq >/dev/null || { echo "install-ops.sh: нужен jq" >&2; exit 2; }

GRANTS="$DEPLOY_DIR/postgres/grants.sql"
[[ -r "$GRANTS" ]] || { echo "install-ops.sh: нет deploy/postgres/grants.sql (нужен restore.sh)" >&2; exit 2; }

# --- Каталоги. Права по RUNBOOK, раздел 1.
run install -d -m 0751 -o root -g crp "$ROOT"
# setgid: новые релизы наследуют группу crp, иначе PM2 от crp не прочитает релиз, собранный crpdeploy.
run install -d -m 2750 -o crpdeploy -g crp "$ROOT/releases"
run install -d -m 0755 -o crpdeploy -g crp "$ROOT/shared"
run install -d -m 0755 -o crpdeploy -g crp "$ROOT/shared/static" "$ROOT/shared/maintenance"
run install -d -m 0750 -o crpdeploy -g crp "$ROOT/shared/state"
# /etc/crp: x для всех, чтобы postgres прочитал backup.env и список ключей (сами файлы с секретами закрыты).
run install -d -m 0751 -o root -g crp /etc/crp
run install -d -m 0755 -o root -g root /usr/local/lib/crp
# Журналы PM2 и крона приложения: читать их должны только crp и группа adm.
run install -d -m 0750 -o crp -g adm /var/log/crp
# Журнал бэкапа БД вне каталога crp (D-041): иначе crp переименовал бы подкаталог и подложил ссылку
# backup.log на файл postgres, а крон от postgres дописал бы туда строки. logrotate (su postgres) создаёт
# в нём .1 и .gz.
run install -d -m 0750 -o postgres -g adm /var/log/crp-backup
# Sticky-бит: crp создаёт свои файлы статусов, но не удаляет и не переименовывает файлы postgres.
run install -d -m 1775 -o postgres -g crp /var/lib/crp-ops
run install -d -m 0700 -o crp -g crp /var/lib/crp /var/lib/crp/files
# Статусы postgres создаём заранее: имена заняты файлами postgres, crp (группа каталога) не сможет
# занять их каталогом или ссылкой; backup.sh дополнительно пишет через mv -T.
for st in backup-status.json manual-status.json; do
  if [[ ! -e /var/lib/crp-ops/$st && ! -L /var/lib/crp-ops/$st ]]; then run install -m 0644 -o postgres -g crp /dev/null "/var/lib/crp-ops/$st"; fi
done
run install -d -m 0711 -o root -g root /var/backups/crp
run install -d -m 0700 -o postgres -g postgres /var/backups/crp/daily /var/backups/crp/weekly /var/backups/crp/monthly /var/backups/crp/manual
run install -d -m 0700 -o crp -g crp /var/backups/crp/files
run install -d -m 0755 /var/www/certbot
# Журнал бэкапа БД пишет postgres, остальные журналы — crp.
if [[ ! -e /var/log/crp-backup/backup.log ]]; then run install -m 0640 -o postgres -g adm /dev/null /var/log/crp-backup/backup.log; fi
# Обновление с прежней раскладки: старый журнал лежал в каталоге crp. Переносить его не нужно (он ротируется
# 14 дней), а каталог остался бы местом, где crp может подложить ссылку: удаляем после переноса крона.
if [[ -d /var/log/crp/backup && ! -L /var/log/crp/backup ]]; then
  say "старый /var/log/crp/backup больше не используется: удалите его после проверки нового журнала (RUNBOOK, раздел 7)"
fi

# --- instance.json: имя, порты, каталог настроек, ветка выкладки. Существующий не перезаписываем.
if [[ ! -f "$ROOT/shared/instance.json" ]]; then
  say "создаю $ROOT/shared/instance.json"
  if ((DRY)); then
    echo "+ write $ROOT/shared/instance.json"
  else
    jq -n --argjson port "${PORT:-3000}" '{name: "crp", port: $port, configDir: "/etc/crp", smokePort: 3109, deployBranch: "main"}' >"$ROOT/shared/instance.json"
    chown crpdeploy:crp "$ROOT/shared/instance.json"
    chmod 0644 "$ROOT/shared/instance.json"
  fi
fi
if [[ -z "$PORT" && -f "$ROOT/shared/instance.json" ]]; then PORT="$(jq -r '.port // 3000' "$ROOT/shared/instance.json")"; fi
PORT="${PORT:-3000}"

# --- Скрипты эксплуатации: копии принадлежат root, код из релиза от postgres и root не запускается.
for f in deploy rollback backup restore run-script healthcheck; do
  run install -m 0755 -o root -g root "$SELF_DIR/$f.sh" "/usr/local/lib/crp/$f.sh"
done
run install -m 0644 -o root -g root "$SELF_DIR/lib.sh" /usr/local/lib/crp/lib.sh
run install -m 0644 -o root -g root "$GRANTS" /usr/local/lib/crp/grants.sql

# --- Крон, logrotate.
run install -m 0644 -o root -g root "$DEPLOY_DIR/cron/crp.cron" /etc/cron.d/crp
run install -m 0644 -o root -g root "$DEPLOY_DIR/logrotate/crp" /etc/logrotate.d/crp

# --- sudoers: сначала проверка синтаксиса, иначе битый файл лишит всех sudo.
if ((DRY)); then
  echo "+ visudo -cf deploy/sudoers/crpdeploy && install -m 0440 /etc/sudoers.d/crpdeploy"
else
  visudo -cf "$DEPLOY_DIR/sudoers/crpdeploy" >/dev/null
  install -m 0440 -o root -g root "$DEPLOY_DIR/sudoers/crpdeploy" /etc/sudoers.d/crpdeploy
fi

# --- nginx: заголовки, страница обслуживания, сайт из шаблона.
run install -m 0644 -o root -g root "$DEPLOY_DIR/nginx/crp-security-headers.conf" /etc/nginx/snippets/crp-security-headers.conf
run install -m 0644 -o crpdeploy -g crp "$DEPLOY_DIR/nginx/maintenance.html" "$ROOT/shared/maintenance/maintenance.html"
render() {
  local tls_ready=0
  if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then tls_ready=1; fi
  if ((tls_ready)); then cat "$DEPLOY_DIR/nginx/crp.conf.template"; else sed '/^# BEGIN-TLS$/,/^# END-TLS$/d' "$DEPLOY_DIR/nginx/crp.conf.template"; fi |
    sed -e "s|{{DOMAIN}}|$DOMAIN|g" -e "s|{{ROOT}}|$ROOT|g" -e "s|{{PORT}}|$PORT|g"
}
if ((DRY)); then
  echo "+ render nginx/crp.conf.template -> /etc/nginx/sites-available/crp.conf (domain=$DOMAIN root=$ROOT port=$PORT)"
else
  render >/etc/nginx/sites-available/crp.conf
  chmod 0644 /etc/nginx/sites-available/crp.conf
  ln -sfn /etc/nginx/sites-available/crp.conf /etc/nginx/sites-enabled/crp.conf
  if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    say "сертификата ещё нет: установлен только порт 80. Получите его (RUNBOOK, раздел 2) и запустите install-ops.sh снова"
  fi
  nginx -t
  if systemctl is-active --quiet nginx; then systemctl reload nginx; fi
fi

# --- Подсказки по тому, что делает только человек.
[[ -f /etc/crp/app.env ]] || say "нет /etc/crp/app.env: создайте по deploy/env/app.env.example (секреты вносит оператор)"
[[ -f /etc/crp/migrate.env ]] || say "нет /etc/crp/migrate.env: создайте по deploy/env/migrate.env.example"
[[ -f /etc/crp/backup.env ]] || say "нет /etc/crp/backup.env: создайте по deploy/env/backup.env.example (вторая копия и ключи age: решение владельца)"
say "готово"
