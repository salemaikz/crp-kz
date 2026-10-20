#!/usr/bin/env bash
# Бэкап платформы обучения ЦРП: backup.sh [--verify-restore] [--label <имя>] [--files]
#   по умолчанию     дамп БД (pg_dump -Fc), проверка, шифрование age, ротация; запуск от postgres (peer);
#   --verify-restore то же и полное восстановление во временную БД со сверкой (крон по воскресеньям);
#   --label <имя>    разовая копия в manual/ без ротации (deploy.sh вызывает с pre-deploy-<id>);
#   --files          архив загруженных файлов (STORAGE_DIR), запуск от crp.
# Настройки — /etc/crp/backup.env (шаблон deploy/env/backup.env.example; секретов там нет).
#
# D-029 ПРЕДЛОЖЕНО, ждёт владельца: где лежит вторая копия в РК (BACKUP_REMOTE), кто хранит
# приватные ключи age (BACKUP_AGE_RECIPIENTS_FILE), приемлем ли RPO 24 часа. До решения скрипт
# работает с локальной копией и честно пишет offsite=false. Приватного ключа на сервере нет.
set -Eeuo pipefail
umask 077

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }

VERIFY=0
LABEL=""
FILES=0
while (($#)); do
  case "$1" in
    --verify-restore) VERIFY=1; shift ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --files) FILES=1; shift ;;
    *) echo "Использование: backup.sh [--verify-restore] [--label <имя>] [--files]" >&2; exit 2 ;;
  esac
done
if [[ -n "$LABEL" ]] && ! [[ "$LABEL" =~ ^[a-z0-9][a-z0-9._-]{0,79}$ ]]; then
  echo "backup.sh: метка — строчные латинские буквы, цифры, точка, дефис, подчёркивание" >&2
  exit 2
fi

read_env_file "${CRP_BACKUP_ENV:-/etc/crp/backup.env}" || { echo "backup.sh: нет /etc/crp/backup.env (шаблон deploy/env/backup.env.example)" >&2; exit 2; }
cfg() { echo "${ENVF[$1]:-$2}"; }

DB="$(cfg BACKUP_DB crp)"
OWNER_ROLE="$(cfg BACKUP_OWNER_ROLE crp_owner)"
DIR="$(cfg BACKUP_DIR /var/backups/crp)"
RECIPIENTS="$(cfg BACKUP_AGE_RECIPIENTS_FILE /etc/crp/backup-recipients.txt)"
KEEP_DAILY="$(cfg BACKUP_KEEP_DAILY 14)"
KEEP_WEEKLY="$(cfg BACKUP_KEEP_WEEKLY 8)"
KEEP_MONTHLY="$(cfg BACKUP_KEEP_MONTHLY 6)"
REMOTE="$(cfg BACKUP_REMOTE '')"
REMOTE_KEY="$(cfg BACKUP_REMOTE_SSH_KEY '')"
# Копия файлов уходит от crp: свой адрес и свой ключ, чтобы взлом приложения не давал записи в хранилище
# дампов БД. Пустой адрес — запасной общий BACKUP_REMOTE; ключ запасным не бывает (D-041): без
# BACKUP_FILES_REMOTE_SSH_KEY копия файлов не уходит.
FILES_REMOTE="$(cfg BACKUP_FILES_REMOTE '')"
FILES_REMOTE_KEY="$(cfg BACKUP_FILES_REMOTE_SSH_KEY '')"
STORAGE="$(cfg STORAGE_DIR '')"
OPS_DIR="${CRP_OPS_DIR:-/var/lib/crp-ops}"
NAME_RE='^[a-z_][a-z0-9_]{0,62}$'
[[ "$DB" =~ $NAME_RE && "$OWNER_ROLE" =~ $NAME_RE ]] || { echo "backup.sh: недопустимое имя БД или роли" >&2; exit 2; }
for n in "$KEEP_DAILY" "$KEEP_WEEKLY" "$KEEP_MONTHLY"; do
  [[ "$n" =~ ^[0-9]+$ && "$n" -ge 1 ]] || { echo "backup.sh: BACKUP_KEEP_* — целые числа от 1" >&2; exit 2; }
done

TS="${CRP_BACKUP_TS:-$(date -u +%Y%m%dT%H%M%SZ)}"
STATUS_FILE="$OPS_DIR/backup-status.json"
if ((FILES)); then STATUS_FILE="$OPS_DIR/files-status.json"; fi
# Разовая копия перед выкладкой не должна подменять статус ночного бэкапа: healthcheck следит за ним.
if [[ -n "$LABEL" ]]; then STATUS_FILE="$OPS_DIR/manual-status.json"; fi
TMP=""
OUT_FILE=""
VERIFIED=false
OFFSITE=false
CHECK_DB=""

# Статус для healthcheck.sh: ok, время, файл, размер, проверено ли восстановление, есть ли вторая копия.
write_status() {
  local ok="$1" size=0 tmp
  if [[ -n "$OUT_FILE" && -f "$OUT_FILE" ]]; then size="$(stat -c %s "$OUT_FILE")"; fi
  mkdir -p "$OPS_DIR" 2>/dev/null || return 0
  # Каталог с sticky-битом (1775): чужой файл в нём не удалить и не переименовать. Временный файл с
  # непредсказуемым именем (mktemp, O_EXCL) нельзя заранее подменить ссылкой; права ставим до mv,
  # чтобы chmod не шёл по имени, которое успели подменить. mv -T: если на месте статуса каталог или
  # ссылка на каталог, файл не уйдёт внутрь него (mv без -T кладёт файл в такой каталог), а mv упадёт.
  tmp="$(mktemp "$OPS_DIR/.status.XXXXXX" 2>/dev/null)" || return 0
  if jq -n --argjson ok "$ok" --argjson at "$(date -u +%s)000" --arg file "$(basename "${OUT_FILE:-}")" \
    --argjson size "$size" --argjson verified "$VERIFIED" --argjson offsite "$OFFSITE" \
    '{ok: $ok, at: $at, file: $file, sizeBytes: $size, verified: $verified, offsite: $offsite}' \
    >"$tmp" 2>/dev/null && chmod 644 "$tmp" 2>/dev/null && mv -fT "$tmp" "$STATUS_FILE" 2>/dev/null; then
    return 0
  fi
  rm -f "$tmp" 2>/dev/null || true
  say "не удалось записать статус $(basename "$STATUS_FILE"): имя занято или нет права (RUNBOOK, раздел 7)"
}
cleanup() {
  if [[ -n "$CHECK_DB" ]]; then dropdb --if-exists "$CHECK_DB" >/dev/null 2>&1 || true; fi
  if [[ -n "$TMP" && -d "$TMP" ]]; then rm -rf "$TMP"; fi
}
on_error() {
  local rc=$1
  trap - ERR
  say "ОШИБКА: код $rc, копия не создана или не проверена"
  write_status false
  exit "$rc"
}
trap 'on_error $?' ERR
trap cleanup EXIT

# Открытые ключи age: без настоящего ключа шифровать нельзя, а хранить дамп открытым нельзя.
check_recipients() {
  [[ -r "$RECIPIENTS" ]] || { say "нет файла получателей $RECIPIENTS (владелец назначает хранителей ключей, D-029)"; return 1; }
  local valid=0 line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^age1[a-z0-9]{50,}$ ]]; then valid=$((valid + 1)); else
      say "в файле получателей строка не похожа на открытый ключ age (замените заглушку)"
      return 1
    fi
  done <"$RECIPIENTS"
  ((valid >= 1)) || { say "в файле получателей нет ни одного открытого ключа age"; return 1; }
}

# Хранение: оставить последние N файлов шаблона в каталоге, остальные (и их .sha256) удалить.
rotate() {
  local dir="$1" pattern="$2" keep="$3" f i=0
  [[ -d "$dir" ]] || return 0
  while IFS= read -r f; do
    i=$((i + 1))
    if ((i > keep)); then rm -f "$dir/$f" "$dir/$f.sha256"; fi
  done < <(find "$dir" -maxdepth 1 -type f -name "$pattern" -printf '%f\n' | sort -r)
}

# Вторая копия в РК: только если владелец указал BACKUP_REMOTE (для файлов — BACKUP_FILES_REMOTE).
push_offsite() {
  local remote="$REMOTE" key="$REMOTE_KEY"
  if ((FILES)); then
    remote="${FILES_REMOTE:-$REMOTE}"
    key="$FILES_REMOTE_KEY"
  fi
  if [[ -z "$remote" ]]; then
    if ((FILES)); then say "BACKUP_FILES_REMOTE и BACKUP_REMOTE не заданы: второй копии файлов нет (решение владельца, D-029)"; else
      say "BACKUP_REMOTE не задан: второй копии нет (решение владельца, D-029)"
    fi
    return 0
  fi
  if ((FILES)); then
    # Общий ключ БД для файлов не подставляем: crp не должен ходить в хранилище дампов (D-041).
    if [[ -z "$key" ]]; then
      say "нужен свой ключ файлов BACKUP_FILES_REMOTE_SSH_KEY (D-041): общий ключ БД для копии файлов не используется"
      return 1
    fi
    # Сравниваем настоящие пути: ссылка или ./ не должны скрыть тот же файл.
    if [[ -n "$REMOTE_KEY" && "$(realpath -e -- "$key" 2>/dev/null || echo "$key")" == "$(realpath -e -- "$REMOTE_KEY" 2>/dev/null || echo "$REMOTE_KEY")" ]]; then
      say "ключ файлов совпадает с ключом БД: заведите отдельный BACKUP_FILES_REMOTE_SSH_KEY (D-041)"
      return 1
    fi
    # Ключ БД читается пользователем, от которого идут файлы (crp): взлом приложения дал бы запись в хранилище дампов.
    if [[ -n "$REMOTE_KEY" && -r "$REMOTE_KEY" ]]; then
      say "ключ БД читается этим пользователем: закройте его (владелец postgres, 0600), копия файлов не отправлена (D-041)"
      return 1
    fi
  fi
  local ssh="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes"
  [[ -z "$key" ]] || ssh="$ssh -i $key"
  # Отправляем только свои подкаталоги: каталоги соседнего пользователя закрыты (0700), и rsync на них
  # давал бы код 23 при каждом запуске. -R сохраняет имена подкаталогов, -H жёсткие ссылки weekly/monthly.
  local -a parts=(daily weekly monthly manual)
  if ((FILES)); then parts=(files); fi
  if (cd "$DIR" && rsync -aHR --ignore-existing --exclude='.tmp.*' -e "$ssh" "${parts[@]}" "$remote/"); then OFFSITE=true; say "вторая копия отправлена"; else
    say "вторая копия НЕ отправлена"
    return 1
  fi
}

# Список таблиц и накатанных миграций БД — для сверки источника и восстановленной копии.
db_tables() { psql -d "$1" -tAX -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"; }
db_migrations() { psql -d "$1" -tAX -c "SELECT name FROM public.schema_migrations ORDER BY 1"; }

# Полное восстановление во временную БД и сверка. Строки не печатаются, только числа.
verify_restore() {
  local dump="$1" t n src chk
  CHECK_DB="${DB}_restorecheck"
  [[ "$CHECK_DB" =~ $NAME_RE ]] || { say "имя проверочной БД недопустимо"; return 1; }
  dropdb --if-exists "$CHECK_DB"
  createdb -O "$OWNER_ROLE" "$CHECK_DB"
  pg_restore --no-owner --role="$OWNER_ROLE" --exit-on-error -d "$CHECK_DB" "$dump"
  src="$(db_tables "$DB")"
  chk="$(db_tables "$CHECK_DB")"
  [[ "$src" == "$chk" ]] || { say "сверка: набор таблиц отличается"; return 1; }
  [[ "$(db_migrations "$DB")" == "$(db_migrations "$CHECK_DB")" ]] || { say "сверка: список миграций отличается"; return 1; }
  n=0
  while IFS= read -r t; do
    [[ "$t" =~ $NAME_RE ]] || { say "сверка: недопустимое имя таблицы"; return 1; }
    psql -d "$CHECK_DB" -tAX -c "SELECT count(*) FROM public.\"$t\"" >/dev/null
    n=$((n + 1))
  done <<<"$chk"
  [[ "$(psql -d "$CHECK_DB" -tAX -c 'SELECT count(*) FROM public.users')" -gt 0 ]] || { say "сверка: в восстановленной БД нет пользователей"; return 1; }
  dropdb "$CHECK_DB"
  CHECK_DB=""
  VERIFIED=true
  say "восстановление проверено: таблиц $n"
}

mkdir -p "$DIR"
chmod 711 "$DIR" 2>/dev/null || true

if ((FILES)); then
  # Файлы: STORAGE_DIR не задан или пуст — флаг UPLOADS выключен, делать нечего.
  if [[ -z "$STORAGE" || ! -d "$STORAGE" ]] || [[ -z "$(find "$STORAGE" -mindepth 1 -print -quit)" ]]; then
    say "STORAGE_DIR пуст или не задан: архивировать нечего"
    exit 0
  fi
  check_recipients
  mkdir -p "$DIR/files"
  TMP="$(mktemp -d "$DIR/files/.tmp.XXXXXX")"
  tar -C "$STORAGE" -czf - . | age -R "$RECIPIENTS" -o "$TMP/out.age"
  OUT_FILE="$DIR/files/files-$TS.tar.gz.age"
  mv "$TMP/out.age" "$OUT_FILE"
  (cd "$DIR/files" && sha256sum "$(basename "$OUT_FILE")" >"$(basename "$OUT_FILE").sha256")
  rotate "$DIR/files" 'files-*.tar.gz.age' "$KEEP_DAILY"
  push_offsite || true
  write_status true
  say "готово: $(basename "$OUT_FILE")"
  exit 0
fi

check_recipients
mkdir -p "$DIR/daily" "$DIR/weekly" "$DIR/monthly" "$DIR/manual"
# Временный каталог внутри daily: он принадлежит postgres, и переименование остаётся в одной файловой системе.
TMP="$(mktemp -d "$DIR/daily/.tmp.XXXXXX")"

# Снимок согласованный: pg_dump работает в одной транзакции REPEATABLE READ.
pg_dump -d "$DB" -Fc -Z 6 -f "$TMP/db.dump"
pg_restore -l "$TMP/db.dump" >/dev/null
if ((VERIFY)); then verify_restore "$TMP/db.dump"; fi

age -R "$RECIPIENTS" -o "$TMP/out.age" "$TMP/db.dump"
rm -f "$TMP/db.dump"

if [[ -n "$LABEL" ]]; then
  OUT_FILE="$DIR/manual/crp-$LABEL-$TS.dump.age"
  mv "$TMP/out.age" "$OUT_FILE"
  (cd "$DIR/manual" && sha256sum "$(basename "$OUT_FILE")" >"$(basename "$OUT_FILE").sha256")
  say "разовая копия: $(basename "$OUT_FILE") (в ротацию не входит, чистится вручную по RUNBOOK)"
else
  OUT_FILE="$DIR/daily/crp-$TS.dump.age"
  mv "$TMP/out.age" "$OUT_FILE"
  (cd "$DIR/daily" && sha256sum "$(basename "$OUT_FILE")" >"$(basename "$OUT_FILE").sha256")
  # День по Астане (UTC+5): воскресенье — недельная копия, первое число — месячная.
  astana_dow="$(date -u -d '+5 hours' +%u)"
  astana_day="$(date -u -d '+5 hours' +%d)"
  base="$(basename "$OUT_FILE")"
  if [[ "$astana_dow" == 7 ]]; then ln -f "$OUT_FILE" "$DIR/weekly/$base" && cp -f "$OUT_FILE.sha256" "$DIR/weekly/$base.sha256"; fi
  if [[ "$astana_day" == 01 ]]; then ln -f "$OUT_FILE" "$DIR/monthly/$base" && cp -f "$OUT_FILE.sha256" "$DIR/monthly/$base.sha256"; fi
  rotate "$DIR/daily" 'crp-*.dump.age' "$KEEP_DAILY"
  rotate "$DIR/weekly" 'crp-*.dump.age' "$KEEP_WEEKLY"
  rotate "$DIR/monthly" 'crp-*.dump.age' "$KEEP_MONTHLY"
  say "готово: $base"
fi

# Вторая копия не отменяет локальную: её сбой — предупреждение в статусе, а не потеря бэкапа.
push_offsite || true
write_status true
