# shellcheck shell=bash disable=SC2034
# Общие функции скриптов эксплуатации ЦРП (docs/ops/RUNBOOK.md). Подключается через `.`, сам ничего не делает.
# Пути и внешние команды переопределяются переменными CRP_* — так скрипты проверяются тестом на шимах.

CRP_ROOT="${CRP_ROOT:-/srv/crp}"
STATE_DIR="$CRP_ROOT/shared/state"
DEPLOY_LOG="$STATE_DIR/deploy.log"
RELEASES_DIR="$CRP_ROOT/releases"
POLL_INTERVAL="${CRP_POLL_INTERVAL:-1}"

# Строка в консоль и в deploy.log. В журнал не попадают значения переменных, пароли и ПДн.
log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  echo "$line"
  if [[ -d "$STATE_DIR" ]]; then echo "$line" >>"$DEPLOY_LOG" 2>/dev/null || true; fi
}

# die <код> <сообщение>: запись в журнал и выход с кодом.
die() {
  local code="$1"
  shift
  log "ОШИБКА: $*"
  exit "$code"
}

# Разбор KEY=VALUE без source и eval: значения не исполняются. Результат — в ассоциативном массиве ENVF.
declare -gA ENVF=()
read_env_file() {
  local file="$1" line key val
  ENVF=()
  [[ -r "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    ENVF["$key"]="$val"
  done <"$file"
}

# inst_get <ключ> [по умолчанию]: поле из shared/instance.json.
inst_get() {
  local v
  v="$(jq -r --arg k "$1" '.[$k] // empty' "$CRP_ROOT/shared/instance.json")"
  echo "${v:-${2:-}}"
}

# Идентификатор релиза: только безопасные символы, без пути.
valid_release_id() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$ && "$1" != *..* ]]
}

# Команда PM2 из CRP_PM2 (по умолчанию от пользователя crp) в массив PM2.
declare -ga PM2=()
load_pm2() { read -r -a PM2 <<<"${CRP_PM2:-sudo -u crp -H pm2}"; }

# Идентификатор релиза, на который указывает current (пусто, если симлинка нет).
current_id() {
  local t
  [[ -L "$CRP_ROOT/current" ]] || return 0
  t="$(readlink "$CRP_ROOT/current")"
  basename "$t"
}

# Атомарная замена симлинка: ссылка рядом, затем rename.
switch_current() {
  local id="$1"
  rm -f "$CRP_ROOT/current.tmp"
  ln -s "releases/$id" "$CRP_ROOT/current.tmp"
  mv -T "$CRP_ROOT/current.tmp" "$CRP_ROOT/current"
}

# Записать id релиза в shared/state/previous (атомарно).
write_previous() {
  printf '%s\n' "$1" >"$STATE_DIR/previous.tmp"
  mv -f "$STATE_DIR/previous.tmp" "$STATE_DIR/previous"
}

# pm2 startOrReload по конфигу из current, затем pm2 save. Дескриптор блокировки (9) демону не отдаём.
reload_app() {
  load_pm2
  "${PM2[@]}" startOrReload "$CRP_ROOT/current/deploy/ecosystem.config.cjs" --update-env 9>&- || return 1
  "${PM2[@]}" save 9>&- || log "pm2 save не удался: после перезагрузки сервера может подняться прежний список процессов"
}

# wait_health <порт> <id релиза> <секунд>: ждём status=ok и release=<id>. Код 0 — дождались.
wait_health() {
  local port="$1" id="$2" limit="$3" out deadline
  deadline=$((SECONDS + limit))
  while ((SECONDS < deadline)); do
    out="$(curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health" 2>/dev/null)" || out=''
    if [[ -n "$out" ]] && jq -e --arg id "$id" '.status == "ok" and .release == $id' >/dev/null 2>&1 <<<"$out"; then
      return 0
    fi
    sleep "$POLL_INTERVAL"
  done
  return 1
}
