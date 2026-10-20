#!/usr/bin/env bash
# Запуск scripts/<имя>.ts из текущего релиза: run-script.sh <имя> [-- аргументы скрипта]
# Для крона (mail-worker, send-reminders, files-sweep) и разовых работ (create-admin).
# flock: не больше одного экземпляра на имя; timeout: зависший скрипт не висит вечно.
# Флаги функций (REMINDERS и др.) проверяет сам скрипт. files-sweep работает и при выключенном UPLOADS.
set -euo pipefail

CRP_ROOT="${CRP_ROOT:-/srv/crp}"
ENV_FILE="${CRP_APP_ENV:-/etc/crp/app.env}"
LOCK_DIR="${CRP_LOCK_DIR:-/run/lock}"
TIMEOUT="${CRP_SCRIPT_TIMEOUT:-15m}"
NODE="${CRP_NODE:-node}"

name="${1:-}"
shift || true
if ! [[ "$name" =~ ^[a-z0-9-]+$ ]]; then
  echo "Использование: run-script.sh <имя> [-- аргументы]" >&2
  exit 2
fi
if [[ "${1:-}" == -- ]]; then shift; fi

cur="$CRP_ROOT/current"
file="$cur/scripts/$name.ts"
if [[ ! -e "$file" ]]; then
  # Крон ставится заранее, а скрипт приходит со своим релизом.
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $name: нет в этом релизе"
  exit 0
fi

exec 8>"$LOCK_DIR/crp-$name.lock"
if ! flock -n 8; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $name: уже выполняется, пропуск"
  exit 0
fi

cd "$cur"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $name: запуск"
rc=0
# --foreground: интерактивным скриптам (create-admin) нужен терминал.
NODE_ENV=production timeout --foreground "$TIMEOUT" "$NODE" --env-file="$ENV_FILE" --import tsx "scripts/$name.ts" "$@" || rc=$?
if ((rc == 124)); then echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $name: остановлен по таймауту $TIMEOUT"; fi
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $name: код $rc"
exit "$rc"
