#!/usr/bin/env bash
# Восстановление БД из бэкапа:
#   restore.sh --file <*.dump.age|*.dump> [--identity <ключ age>] [--target <БД>] [--force-prod] [--keep]
# Запуск от postgres (sudo -u postgres). Ключ --identity оператор приносит на время восстановления
# (из менеджера паролей или с носителя) и удаляет после; на сервере его нет (D-029, предложено).
#
# Без --target восстановление идёт в новую БД crp_restore_<время>: сверяем счётчики и удаляем её
# (без --keep). Цель, равная боевой БД, требует --force-prod и остановленного приложения; боевая БД
# не удаляется, а переименовывается в <БД>_broken_<время>. Порядок аварии — RUNBOOK, раздел 6.3.
# Строки таблиц не печатаются: только числа и имена миграций.
set -Eeuo pipefail
umask 077

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restore: $*"; }

FILE=""
IDENTITY=""
TARGET=""
FORCE=0
KEEP=0
while (($#)); do
  case "$1" in
    --file) FILE="${2:-}"; shift 2 ;;
    --identity) IDENTITY="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --force-prod) FORCE=1; shift ;;
    --keep) KEEP=1; shift ;;
    *) echo "Использование: restore.sh --file <архив> [--identity <ключ>] [--target <БД>] [--force-prod] [--keep]" >&2; exit 2 ;;
  esac
done
[[ -n "$FILE" && -r "$FILE" ]] || { echo "restore.sh: укажите читаемый --file" >&2; exit 2; }

read_env_file "${CRP_BACKUP_ENV:-/etc/crp/backup.env}" || true
cfg() { echo "${ENVF[$1]:-$2}"; }
PROD_DB="$(cfg BACKUP_DB crp)"
OWNER_ROLE="$(cfg BACKUP_OWNER_ROLE crp_owner)"
APP_ROLE="$(cfg BACKUP_APP_ROLE crp_app)"
# Порт приложения — из shared/instance.json, если файл читается (порт может быть нестандартным);
# иначе CRP_APP_PORT или 3000. Проверка «приложение остановлено» иначе пропустила бы работающее.
APP_PORT="${CRP_APP_PORT:-3000}"
if [[ -r "${CRP_ROOT}/shared/instance.json" ]]; then
  inst_port="$(jq -r '.port // empty' "${CRP_ROOT}/shared/instance.json" 2>/dev/null || true)"
  if [[ "$inst_port" =~ ^[0-9]{2,5}$ ]]; then APP_PORT="$inst_port"; fi
fi
GRANTS_SQL="${CRP_GRANTS_SQL:-$SELF_DIR/grants.sql}"
NAME_RE='^[a-z_][a-z0-9_]{0,62}$'
TS="$(date -u +%Y%m%d%H%M%S)"
[[ -n "$TARGET" ]] || TARGET="crp_restore_$TS"
for n in "$PROD_DB" "$OWNER_ROLE" "$APP_ROLE" "$TARGET"; do
  [[ "$n" =~ $NAME_RE ]] || { echo "restore.sh: недопустимое имя БД или роли" >&2; exit 2; }
done

TMP=""
RENAMED=""
CREATED=0
cleanup() {
  if [[ -n "$TMP" && -d "$TMP" ]]; then rm -rf "$TMP"; fi
}
on_error() {
  local rc=$1
  trap - ERR
  say "ОШИБКА: код $rc"
  if ((CREATED)) && [[ -n "$RENAMED" ]]; then
    say "боевая БД сохранена как $RENAMED; вернуть: ALTER DATABASE $RENAMED RENAME TO $PROD_DB (после DROP DATABASE $TARGET)"
  fi
  exit "$rc"
}
trap 'on_error $?' ERR
trap cleanup EXIT

if [[ "$TARGET" == "$PROD_DB" ]]; then
  ((FORCE)) || { echo "restore.sh: восстановление в боевую БД требует --force-prod" >&2; exit 2; }
  # Приложение должно быть остановлено: отвечает на порту — значит, работает.
  if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$APP_PORT/api/health"; then
    echo "restore.sh: приложение отвечает на порту $APP_PORT. Остановите его (pm2 stop) и повторите." >&2
    exit 2
  fi
fi

TMP="$(mktemp -d)"
DUMP="$TMP/db.dump"
case "$FILE" in
  *.age)
    [[ -n "$IDENTITY" && -r "$IDENTITY" ]] || { echo "restore.sh: для .age нужен --identity" >&2; exit 2; }
    age -d -i "$IDENTITY" -o "$DUMP" "$FILE"
    ;;
  *.dump) cp "$FILE" "$DUMP" ;;
  *) echo "restore.sh: ожидается файл .dump.age или .dump" >&2; exit 2 ;;
esac
pg_restore -l "$DUMP" >/dev/null

if [[ "$TARGET" == "$PROD_DB" ]]; then
  RENAMED="${PROD_DB}_broken_$TS"
  say "боевая БД переименовывается в $RENAMED"
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE \"$PROD_DB\" RENAME TO \"$RENAMED\""
fi
createdb -O "$OWNER_ROLE" "$TARGET"
CREATED=1
pg_restore --no-owner --role="$OWNER_ROLE" --exit-on-error -d "$TARGET" "$DUMP"

# Права приложения: тот же grants.sql, что у выкладки (имена ролей — параметрами сессии).
if [[ -r "$GRANTS_SQL" ]]; then
  psql -X -v ON_ERROR_STOP=1 -d "$TARGET" \
    -c "SELECT set_config('crp.app_role', '$APP_ROLE', false), set_config('crp.owner_role', '$OWNER_ROLE', false)" \
    -f "$GRANTS_SQL" >/dev/null
  say "права выданы"
else
  say "ВНИМАНИЕ: нет $GRANTS_SQL, права приложения не выданы: выполните npm run db:grants"
fi

# Сверка: число таблиц, последняя миграция, счётчики строк. Только числа.
tables="$(psql -X -d "$TARGET" -tA -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
n=0
say "счётчики строк по таблицам:"
while IFS= read -r t; do
  [[ -n "$t" ]] || continue
  [[ "$t" =~ $NAME_RE ]] || { say "недопустимое имя таблицы"; exit 1; }
  c="$(psql -X -d "$TARGET" -tA -c "SELECT count(*) FROM public.\"$t\"")"
  echo "  $t: $c"
  n=$((n + 1))
done <<<"$tables"
last="$(psql -X -d "$TARGET" -tA -c "SELECT max(name) FROM public.schema_migrations")"
say "таблиц: $n; последняя миграция: ${last:-нет}"
[[ "$(psql -X -d "$TARGET" -tA -c 'SELECT count(*) FROM public.users')" -gt 0 ]] || say "ВНИМАНИЕ: в восстановленной БД нет пользователей"

if [[ "$TARGET" == "$PROD_DB" ]]; then
  say "боевая БД восстановлена. Дальше: db:migrate (если код новее дампа), db:grants, pm2 start, проверка /api/health. Старая БД: $RENAMED"
elif ((KEEP)); then
  say "БД $TARGET оставлена (--keep); удалить: dropdb $TARGET"
else
  dropdb "$TARGET"
  say "учебное восстановление прошло, БД $TARGET удалена"
fi
