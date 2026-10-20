#!/usr/bin/env bash
# Мониторинг платформы: крон каждые 5 минут от crp (RUNBOOK, раздел 8).
# Проверки дают ok, warn или fail; состояние пишется в monitor-state.json. Алерт уходит только при
# смене состояния (ok -> fail, fail -> ok), чтобы не спамить. Текст алерта: имя проверки, имя
# экземпляра и время. Без IP, ПДн и текстов ошибок.
# Канал: Telegram-бот, если владелец задал ALERT_TELEGRAM_* в monitor.env (решение владельца, D-009:
# сообщения без ПДн, но сервис зарубежный); иначе logger (journald) и строка в журнал.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

OPS_DIR="${CRP_OPS_DIR:-/var/lib/crp-ops}"
STATE_FILE="$OPS_DIR/monitor-state.json"
now_s="$(date -u +%s)"

read_env_file "${CRP_MONITOR_ENV:-/etc/crp/monitor.env}" || true
DOMAIN="${ENVF[DOMAIN]:-}"
TG_TOKEN="${ENVF[ALERT_TELEGRAM_BOT_TOKEN]:-}"
TG_CHAT="${ENVF[ALERT_TELEGRAM_CHAT_ID]:-}"
STORAGE=""
BACKUP_REMOTE=""
BACKUP_FILES_REMOTE=""
if read_env_file "${CRP_BACKUP_ENV:-/etc/crp/backup.env}"; then
  BACKUP_REMOTE="${ENVF[BACKUP_REMOTE]:-}"
  BACKUP_FILES_REMOTE="${ENVF[BACKUP_FILES_REMOTE]:-}"
fi
if read_env_file "${CRP_APP_ENV:-/etc/crp/app.env}"; then STORAGE="${ENVF[STORAGE_DIR]:-}"; fi
if [[ -f "$CRP_ROOT/shared/instance.json" ]]; then
  PORT="$(inst_get port 3000)"
  NAME="$(inst_get name crp)"
else
  PORT=3000
  NAME=crp
fi

declare -A result=()
declare -A extra=()

# --- Приложение: /api/health отвечает status=ok быстрее 5 секунд.
check_health() {
  local body
  if body="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null)" && jq -e '.status == "ok"' >/dev/null 2>&1 <<<"$body"; then
    result[app_health]=ok
  else
    result[app_health]=fail
  fi
}

# --- PM2: процесс online; рост числа рестартов за час.
check_pm2() {
  local list status restarts base base_at
  local -a pm2cmd
  # Крон идёт от самого crp, поэтому без sudo (в отличие от deploy.sh).
  read -r -a pm2cmd <<<"${CRP_HEALTH_PM2:-pm2}"
  if ! list="$("${pm2cmd[@]}" jlist 2>/dev/null)" || [[ -z "$list" ]]; then
    result[pm2]=fail
    return
  fi
  status="$(jq -r --arg n "$NAME" '[.[] | select(.name == $n)][0].pm2_env.status // "missing"' <<<"$list")"
  restarts="$(jq -r --arg n "$NAME" '[.[] | select(.name == $n)][0].pm2_env.restart_time // 0' <<<"$list")"
  if [[ "$status" != online ]]; then
    result[pm2]=fail
    return
  fi
  base="$(jq -r '.restartBase // empty' "$STATE_FILE" 2>/dev/null || true)"
  base_at="$(jq -r '.restartBaseAt // empty' "$STATE_FILE" 2>/dev/null || true)"
  if [[ -z "$base" || -z "$base_at" || $((now_s - base_at)) -gt 3600 || "$restarts" -lt "$base" ]]; then
    base="$restarts"
    base_at="$now_s"
  fi
  extra[restartBase]="$base"
  extra[restartBaseAt]="$base_at"
  if ((restarts - base >= 3)); then result[pm2]=warn; else result[pm2]=ok; fi
}

# --- Свежесть бэкапов: статус ok и моложе 26 часов.
fresh_status() {
  local f="$OPS_DIR/$1" ok at
  [[ -r "$f" ]] || return 1
  ok="$(jq -r '.ok' "$f" 2>/dev/null)" || return 1
  at="$(jq -r '.at' "$f" 2>/dev/null)" || return 1
  [[ "$ok" == true && "$at" =~ ^[0-9]+$ ]] || return 1
  ((now_s - at / 1000 < 26 * 3600))
}
# Хранилище файлов не пусто: только тогда backup.sh --files что-то архивирует и статус имеет смысл.
storage_nonempty() {
  [[ -n "$STORAGE" && -d "$STORAGE" && -n "$(find "$STORAGE" -mindepth 1 -print -quit 2>/dev/null)" ]]
}
check_backup() {
  if fresh_status backup-status.json; then result[backup]=ok; else result[backup]=fail; fi
  if storage_nonempty; then
    if fresh_status files-status.json; then result[backup_files]=ok; else result[backup_files]=fail; fi
  fi
  check_offsite
}

# --- Вторая копия: задана, но последний бэкап БД или файлов её не отправил (offsite=false).
# Первые 48 часов подряд предупреждение, потом отказ с алертом: молчаливый сбой хранилища
# (смена ключа хоста, сеть) иначе остался бы виден только в monitor-state.json.
# files-status.json учитывается, только если хранилище не пусто, задан адрес копии файлов (свой или
# общий) и статус моложе 26 часов: устаревший статус уже даёт backup_files=fail, второй раз его не считаем.
check_offsite() {
  local f at bad=0 since files_remote="${BACKUP_FILES_REMOTE:-$BACKUP_REMOTE}"
  [[ -n "$BACKUP_REMOTE" || -n "$files_remote" ]] || return 0
  if [[ -n "$BACKUP_REMOTE" && -r "$OPS_DIR/backup-status.json" ]]; then
    if [[ "$(jq -r '.offsite' "$OPS_DIR/backup-status.json" 2>/dev/null)" == false ]]; then bad=1; fi
  fi
  f="$OPS_DIR/files-status.json"
  if [[ -n "$files_remote" && -r "$f" ]] && storage_nonempty; then
    at="$(jq -r '.at' "$f" 2>/dev/null || true)"
    if [[ "$at" =~ ^[0-9]+$ ]] && ((now_s - at / 1000 < 26 * 3600)) && [[ "$(jq -r '.offsite' "$f" 2>/dev/null)" == false ]]; then bad=1; fi
  fi
  if ((bad == 0)); then
    result[backup_offsite]=ok
    return 0
  fi
  since="$(jq -r '.offsiteSince // empty' "$STATE_FILE" 2>/dev/null || true)"
  [[ "$since" =~ ^[0-9]+$ ]] || since="$now_s"
  extra[offsiteSince]="$since"
  if ((now_s - since >= 48 * 3600)); then result[backup_offsite]=fail; else result[backup_offsite]=warn; fi
}

# --- Свободное место: предупреждение меньше 20 %, отказ меньше 10 %.
check_disk() {
  local worst=ok p free
  for p in / /var/backups ${STORAGE:+"$STORAGE"}; do
    [[ -e "$p" ]] || continue
    free=$((100 - $(df --output=pcent "$p" | tail -n 1 | tr -dc '0-9')))
    if ((free < 10)); then worst=fail; elif ((free < 20)) && [[ "$worst" != fail ]]; then worst=warn; fi
  done
  result[disk]="$worst"
}

# --- Срок сертификата: предупреждение меньше 21 дня, отказ меньше 7 дней.
check_cert() {
  [[ -n "$DOMAIN" ]] || return 0
  local end end_s days
  end="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)" || end=''
  if [[ -z "$end" ]] || ! end_s="$(date -u -d "$end" +%s 2>/dev/null)"; then
    result[tls_cert]=fail
    return
  fi
  days=$(((end_s - now_s) / 86400))
  if ((days < 7)); then result[tls_cert]=fail; elif ((days < 21)); then result[tls_cert]=warn; else result[tls_cert]=ok; fi
}

# --- Внешний взгляд: домен снаружи (проверяет DNS, TLS и nginx).
check_external() {
  [[ -n "$DOMAIN" ]] || return 0
  if curl -fsS --max-time 10 -o /dev/null "https://$DOMAIN/api/health" 2>/dev/null; then result[external]=ok; else result[external]=fail; fi
}

alert() {
  local text="$1"
  logger -t crp-alert "$text" 2>/dev/null || true
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ALERT $text"
  if [[ -n "$TG_TOKEN" && -n "$TG_CHAT" ]]; then
    # Токен бота в адресе запроса: адрес передаём конфигом через stdin, чтобы он не попал в argv
    # (ps и /proc/*/cmdline видят все локальные пользователи). Лог curl не ведём, ошибки не печатаем.
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TG_TOKEN" |
      curl -fsS --max-time 10 -o /dev/null -K - \
      --data-urlencode "chat_id=$TG_CHAT" --data-urlencode "text=$text" >/dev/null 2>&1 || true
  fi
}

mkdir -p "$OPS_DIR" 2>/dev/null || true
check_health
check_pm2
check_backup
check_disk
check_cert
check_external

# Сравнение с прошлым состоянием: алерт только при смене ok/fail (warn считается рабочим состоянием).
prev_json='{}'
if [[ -r "$STATE_FILE" ]]; then prev_json="$(jq -c '.checks // {}' "$STATE_FILE" 2>/dev/null || echo '{}')"; fi
stamp="$(date -u +%H:%M)"
for k in "${!result[@]}"; do
  cur="${result[$k]}"
  old="$(jq -r --arg k "$k" '.[$k] // "ok"' <<<"$prev_json")"
  if [[ "$cur" == fail && "$old" != fail ]]; then
    alert "$NAME: проверка $k не пройдена, $stamp UTC"
  elif [[ "$cur" != fail && "$old" == fail ]]; then
    alert "$NAME: проверка $k снова в порядке, $stamp UTC"
  fi
done

# Временный файл с непредсказуемым именем: заранее подложенную ссылку на него не поставить (D-041).
state_tmp="$(mktemp "$OPS_DIR/.state.XXXXXX")"
trap 'rm -f "$state_tmp"' EXIT
checks_json="$(for k in "${!result[@]}"; do printf '%s\n%s\n' "$k" "${result[$k]}"; done | jq -Rn '[inputs] as $a | reduce range(0; $a|length; 2) as $i ({}; .[$a[$i]] = $a[$i+1])')"
jq -n --argjson checks "$checks_json" --argjson at "${now_s}000" \
  --argjson rb "${extra[restartBase]:-0}" --argjson rba "${extra[restartBaseAt]:-$now_s}" \
  --arg os "${extra[offsiteSince]:-}" \
  '{at: $at, checks: $checks, restartBase: $rb, restartBaseAt: $rba} + (if $os == "" then {} else {offsiteSince: ($os | tonumber)} end)' >"$state_tmp"
chmod 644 "$state_tmp"
mv -fT "$state_tmp" "$STATE_FILE"
