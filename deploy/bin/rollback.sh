#!/usr/bin/env bash
# Откат на предыдущий релиз: rollback.sh [--to <id релиза>] [--reason <причина>]
# Без сборки, только переключение симлинка и pm2 startOrReload (около 20 секунд). БД не откатывается:
# миграции только добавляют, старый код с новой схемой работает (RUNBOOK, раздел 5).
#
# Коды выхода: 0 откат выполнен; 1 релиз переключён, но не отвечает; 2 проверки не пройдены,
# ничего не менялось; 4 идёт выкладка или другой откат.
set -euo pipefail
umask 027

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

HEALTH_TIMEOUT="${CRP_HEALTH_TIMEOUT:-90}"
TARGET=""
REASON="manual"
while (($#)); do
  case "$1" in
    --to) TARGET="${2:-}"; shift 2 ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    *) echo "Использование: rollback.sh [--to <id релиза>] [--reason <причина>]" >&2; exit 2 ;;
  esac
done
[[ "$REASON" =~ ^[A-Za-z0-9._-]{1,60}$ ]] || { echo "rollback.sh: причина — до 60 символов из A-Z a-z 0-9 . _ -" >&2; exit 2; }

[[ -f "$CRP_ROOT/shared/instance.json" ]] || die 2 "нет shared/instance.json"
mkdir -p "$STATE_DIR"
# Откат из deploy.sh идёт под его блокировкой (CRP_DEPLOY_LOCK_HELD), отдельный запуск берёт свою.
if [[ "${CRP_DEPLOY_LOCK_HELD:-}" != 1 ]]; then
  exec 9>"$STATE_DIR/deploy.lock"
  flock -n 9 || { echo "Уже идёт выкладка или откат." >&2; exit 4; }
fi

PORT="$(inst_get port 3000)"
CURRENT="$(current_id)"

if [[ -z "$TARGET" ]]; then
  if [[ -s "$STATE_DIR/previous" ]]; then
    TARGET="$(head -n 1 "$STATE_DIR/previous")"
  else
    # previous нет: берём ближайший более старый релиз по имени (имена начинаются с UTC-времени).
    TARGET="$(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | grep -vxF -- "$CURRENT" | head -n 1 || true)"
  fi
fi
[[ -n "$TARGET" ]] || die 2 "некуда откатываться: нет previous и других релизов"
valid_release_id "$TARGET" || die 2 "недопустимый id релиза"
[[ -d "$RELEASES_DIR/$TARGET" ]] || die 2 "релиза $TARGET нет в releases/"
[[ -s "$RELEASES_DIR/$TARGET/.next/BUILD_ID" && -s "$RELEASES_DIR/$TARGET/RELEASE.json" ]] ||
  die 2 "релиз $TARGET неполный (нет .next/BUILD_ID или RELEASE.json)"
[[ "$TARGET" != "$CURRENT" ]] || die 2 "релиз $TARGET уже текущий"

# previous становится прежним current: повторный rollback возвращает обратно.
if [[ -n "$CURRENT" ]]; then write_previous "$CURRENT"; fi
switch_current "$TARGET"
log "rollback from=${CURRENT:-none} to=$TARGET reason=$REASON"

if reload_app && wait_health "$PORT" "$TARGET" "$HEALTH_TIMEOUT"; then
  log "rollback выполнен, релиз $TARGET отвечает"
else
  die 1 "после отката релиз $TARGET не отвечает: смотрите RUNBOOK, раздел 11"
fi
