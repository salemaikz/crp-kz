#!/usr/bin/env bash
# Выкладка релиза на сервер ЦРП: deploy.sh <тег vX.Y.Z> [--skip-ci-check]
# Запускает оператор от пользователя crpdeploy (sudo -u crpdeploy /usr/local/lib/crp/deploy.sh v0.3.0).
# Порядок и обоснования — docs/ops/RUNBOOK.md, раздел 4; решение D-027.
#
# Коды выхода: 0 выложено; 1 сбой после переключения, откат выполнен; 2 сбой до переключения,
# прод не тронут; 4 уже идёт другая выкладка.
set -euo pipefail
umask 027

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

NODE="${CRP_NODE:-node}"
BACKUP_SCRIPT="${CRP_BACKUP_SCRIPT:-/usr/local/lib/crp/backup.sh}"
REPO="${CRP_REPO:-salemaikz/crp-kz}"
CI_CHECK_NAME="${CRP_CI_CHECK_NAME:-Проверки и e2e}"
KEEP_RELEASES="${CRP_KEEP_RELEASES:-5}"
SMOKE_TIMEOUT="${CRP_SMOKE_TIMEOUT:-60}"
HEALTH_TIMEOUT="${CRP_HEALTH_TIMEOUT:-90}"
# Группа приложения для .next/cache (пишет пользователь crp). Пусто — не менять (тесты).
APP_GROUP="${CRP_APP_GROUP-crp}"
# Адрес БД на время сборки: заведомо недоступный. Сборка не должна ходить в БД (миграции идут позже,
# а production-приложение без накатанных миграций падает на assertMigrated). Пароля в адресе нет.
BUILD_DATABASE_URL="postgres://crp_build_nodb@127.0.0.1:9/nodb?sslmode=require"

TAG=""
SKIP_CI=0
for arg in "$@"; do
  case "$arg" in
    --skip-ci-check) SKIP_CI=1 ;;
    -*) echo "deploy.sh: неизвестный флаг $arg" >&2; exit 2 ;;
    *)
      if [[ -n "$TAG" ]]; then echo "deploy.sh: лишний аргумент" >&2; exit 2; fi
      TAG="$arg"
      ;;
  esac
done

# 1. Вход. Тег проверяется до любых обращений к git и файловой системе.
if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]]; then
  echo "Использование: deploy.sh vX.Y.Z [--skip-ci-check]" >&2
  exit 2
fi

# Окружение оператора не должно влиять на сборку и проверки.
unset DATABASE_URL PGLITE_DIR DEMO_MODE SEED_DEMO NODE_ENV DB_MIGRATE_ON_START

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
if ! flock -n 9; then
  echo "Уже идёт другая выкладка или откат." >&2
  exit 4
fi
export CRP_DEPLOY_LOCK_HELD=1

PHASE=pre
ID=""
REL=""
SMOKE_PID=""

on_exit() {
  local rc=$?
  if [[ -n "$SMOKE_PID" ]]; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
  fi
  if ((rc != 0)) && [[ "$PHASE" == pre ]]; then
    # Любой необработанный сбой до переключения — «прод не тронут» (код 2); недособранный релиз убираем.
    if [[ -n "$REL" && -d "$REL" ]]; then
      rm -rf "$REL"
      log "каталог неудавшегося релиза удалён id=$ID (журналы сборки остались в shared/state)"
    fi
    if ((rc == 1)); then rc=2; fi
    exit "$rc"
  fi
}
trap on_exit EXIT

[[ -f "$CRP_ROOT/shared/instance.json" ]] || die 2 "нет shared/instance.json: сервер не установлен по RUNBOOK, раздел 2"
NAME="$(inst_get name crp)"
PORT="$(inst_get port 3000)"
SMOKE_PORT="$(inst_get smokePort 3109)"
CONFIG_DIR="$(inst_get configDir /etc/crp)"
BRANCH="$(inst_get deployBranch main)"
[[ "$PORT" =~ ^[0-9]+$ && "$SMOKE_PORT" =~ ^[0-9]+$ ]] || die 2 "instance.json: port и smokePort должны быть числами"
[[ -r "$CONFIG_DIR/app.env" && -r "$CONFIG_DIR/migrate.env" ]] || die 2 "нет $CONFIG_DIR/app.env или migrate.env (шаблоны — deploy/env)"
log "step=start tag=$TAG instance=$NAME"

# 2. Код: только потомок основной ветки с зелёным CI.
git -C "$CRP_ROOT/repo.git" fetch --prune --tags origin >/dev/null 2>&1 || die 2 "git fetch не удался"
SHA="$(git -C "$CRP_ROOT/repo.git" rev-parse "$TAG^{commit}" 2>/dev/null)" || die 2 "тега $TAG нет в репозитории"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die 2 "git вернул не sha"
git -C "$CRP_ROOT/repo.git" merge-base --is-ancestor "$SHA" "refs/heads/$BRANCH" ||
  die 2 "тег $TAG не входит в ветку $BRANCH: выкладываем только код из основной ветки"
if ((SKIP_CI)); then
  log "ВНИМАНИЕ: проверка CI пропущена флагом --skip-ci-check sha=$SHA"
else
  checks="$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/commits/$SHA/check-runs?per_page=100")" || die 2 "не удалось получить статус CI"
  jq -e --arg n "$CI_CHECK_NAME" '[.check_runs[]? | select(.name == $n and .conclusion == "success")] | length > 0' \
    >/dev/null <<<"$checks" || die 2 "CI для $SHA не зелёный (проверка «$CI_CHECK_NAME»)"
fi
log "step=code sha=$SHA"

# 3. Каталог релиза: чистая выгрузка тега без .git.
TS="${CRP_TS:-$(date -u +%Y%m%d-%H%M%S)}"
ID="$TS-$TAG"
valid_release_id "$ID" || die 2 "недопустимый id релиза"
REL="$RELEASES_DIR/$ID"
[[ ! -e "$REL" ]] || die 2 "релиз $ID уже существует"
mkdir -p "$REL"
# Группа релиза обязана быть группой приложения: каталог releases с setgid (install-ops.sh) передаёт её
# новым релизам. Иначе PM2 от crp не прочитает релиз, и проверка на smoke-порту этого не заметит.
if [[ -n "$APP_GROUP" && "$(stat -c %G "$REL")" != "$APP_GROUP" ]]; then
  die 2 "группа каталога релиза не $APP_GROUP: выставьте setgid на releases (install-ops.sh, RUNBOOK раздел 2)"
fi
git -C "$CRP_ROOT/repo.git" archive "$SHA" | tar -x -C "$REL"
jq -n --arg id "$ID" --arg tag "$TAG" --arg sha "$SHA" --argjson t "$(date -u +%s)000" \
  '{id: $id, tag: $tag, sha: $sha, builtAt: $t}' >"$REL/RELEASE.json"
ln -s "$CONFIG_DIR/app.env" "$REL/.env.production"
log "step=checkout id=$ID"

# Запуск Node-скрипта релиза с env-файлом: от приложения или от владельца схемы.
run_node() {
  local envfile="$1"
  shift
  (cd "$REL" && NODE_ENV=production "$NODE" --env-file="$envfile" --import tsx "$@")
}

# 4. Зависимости строго по lock-файлу; dev нужны для tsx (миграции, крон) и Tailwind.
BUILD_LOG="$STATE_DIR/build-$ID.log"
(cd "$REL" && npm ci --include=dev --no-audit --no-fund) >"$BUILD_LOG" 2>&1 ||
  { tail -n 30 "$BUILD_LOG"; die 2 "npm ci не удался (полный журнал: $BUILD_LOG)"; }
log "step=deps"

# 5. Проверка окружения. Вывод — только коды правил, без значений переменных.
prc=0
pout="$(run_node "$CONFIG_DIR/app.env" scripts/ops-preflight.ts --db 2>&1)" || prc=$?
while IFS= read -r l; do
  if [[ -n "$l" ]]; then log "preflight $l"; fi
done <<<"$pout"
((prc == 0)) || die 2 "ops-preflight нашёл ошибки: релиз не собран, прод не тронут"
log "step=preflight"

# 6. Сборка. В окружении сборки уже есть .env.production, но БД на этом шаге не нужна:
# подставляем недоступный адрес. Если сборка полезет в БД, она упадёт здесь, а не на проде.
(cd "$REL" && DATABASE_URL="$BUILD_DATABASE_URL" NEXT_DEPLOYMENT_ID="$ID" NEXT_TELEMETRY_DISABLED=1 npm run build) \
  >>"$BUILD_LOG" 2>&1 ||
  { tail -n 30 "$BUILD_LOG"; die 2 "сборка не удалась (сборка не должна обращаться к БД; журнал: $BUILD_LOG)"; }
[[ -s "$REL/.next/BUILD_ID" ]] || die 2 "после сборки нет .next/BUILD_ID"
mkdir -p "$REL/.next/cache"
if [[ -n "$APP_GROUP" ]]; then
  if ! { chgrp "$APP_GROUP" "$REL/.next/cache" && chmod 2770 "$REL/.next/cache"; }; then
    die 2 "не удалось выдать группе $APP_GROUP запись в .next/cache"
  fi
  # Подкаталоги, которые создаст crp (umask 022), по умолчанию получили бы права 0755 и стали бы
  # неудаляемыми для crpdeploy. Default ACL даёт группе rwX на всё новое. Без ACL уборка старых
  # релизов нефатальна (шаг 15), но такие релизы останутся на диске.
  if command -v setfacl >/dev/null 2>&1; then
    setfacl -d -m "g:$APP_GROUP:rwX" "$REL/.next/cache" 2>/dev/null || log "setfacl не удался: старые релизы могут не удаляться (RUNBOOK, раздел 4)"
  else
    log "нет setfacl (пакет acl): старые релизы могут не удаляться (RUNBOOK, раздел 4)"
  fi
fi
log "step=build"

# 7. Статика релиза в общий каталог, без --delete: чанки старых страниц остаются доступны.
# Файлы отдаёт nginx от www-data, вне групп crp и crpdeploy: права задаём явно, а не от umask 027 сборки.
(
  umask 022
  mkdir -p "$CRP_ROOT/shared/static/_next/static"
  rsync -a --chmod=D755,F644 "$REL/.next/static/" "$CRP_ROOT/shared/static/_next/static/"
)
log "step=static"

# 8. Бэкап перед миграциями. Код db:status разбираем явно, а не через set -e:
# иначе код 3 оборвал бы скрипт до бэкапа.
src=0
sout="$(run_node "$CONFIG_DIR/migrate.env" scripts/db-migrate.ts --status 2>&1)" || src=$?
case "$src" in
  0) log "step=status pending=0 бэкап не нужен" ;;
  3)
    log "step=status есть ненакатанные миграции, делаем бэкап"
    read -r -a SUDO_PG <<<"${CRP_SUDO_POSTGRES-sudo -u postgres}"
    "${SUDO_PG[@]}" "$BACKUP_SCRIPT" --label "pre-deploy-$ID" || die 2 "бэкап перед миграциями не удался: миграции не запускались"
    ;;
  *) die 2 "db:status завершился с кодом $src: прод не тронут" ;;
esac
pending=0
if [[ "$sout" =~ Не\ накатаны\ \(([0-9]+)\) ]]; then pending="${BASH_REMATCH[1]}"; fi

# 9. Миграции от владельца схемы: одна транзакция, блокировка, lock_timeout. Ошибка — стоп,
# транзакция откатилась, прод работает на старом релизе со старой схемой.
run_node "$CONFIG_DIR/migrate.env" scripts/db-migrate.ts || die 2 "миграции не применились (транзакция откатилась, прод не тронут)"
log "step=migrate"

# 10. Права приложения на новые объекты.
run_node "$CONFIG_DIR/migrate.env" scripts/db-grants.ts || die 2 "db-grants не удался"
log "step=grants"

# 11. Проверка нового релиза на отдельном порту до переключения.
(cd "$REL" && exec env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_DEPLOYMENT_ID="$ID" \
  "$REL/node_modules/.bin/next" start -H 127.0.0.1 -p "$SMOKE_PORT") >"$STATE_DIR/smoke-$ID.log" 2>&1 9>&- &
SMOKE_PID=$!
if ! wait_health "$SMOKE_PORT" "$ID" "$SMOKE_TIMEOUT"; then
  tail -n 20 "$STATE_DIR/smoke-$ID.log" 2>/dev/null || true
  die 2 "новый релиз не прошёл проверку на порту $SMOKE_PORT: переключения нет (миграции остались, они только добавляют)"
fi
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$SMOKE_PORT/ru" || true)"
[[ "$code" == 200 ]] || die 2 "GET /ru на порту проверки вернул $code: переключения нет"
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
SMOKE_PID=""
log "step=smoke"

# 12. Переключение.
PREV="$(current_id)"
# previous пишем только после успешного переключения: при сбое switch_current (код 2) он остаётся прежним.
switch_current "$ID"
if [[ -n "$PREV" ]]; then write_previous "$PREV"; else rm -f "$STATE_DIR/previous"; fi
PHASE=post
log "step=switch from=${PREV:-none} to=$ID"

# 13–14. Перезагрузка PM2 и проверка. Провал — автоматический откат.
if reload_app && wait_health "$PORT" "$ID" "$HEALTH_TIMEOUT"; then
  log "step=health"
else
  log "ОШИБКА: после переключения релиз $ID не отвечает"
  if [[ -n "$PREV" ]]; then
    "$SELF_DIR/rollback.sh" --to "$PREV" --reason post-deploy-health || log "ОШИБКА: откат тоже не удался, нужно вмешательство (RUNBOOK, раздел 11)"
  else
    log "откатываться некуда: это первая выкладка"
  fi
  exit 1
fi

# 15. Уборка: последние KEEP_RELEASES релизов, а также current и previous. Из общей статики
# удаляем только файлы, которых нет ни в одном оставленном релизе.
mapfile -t all < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
declare -A keep=()
i=0
for r in "${all[@]}"; do
  if ((i < KEEP_RELEASES)); then keep["$r"]=1; fi
  i=$((i + 1))
done
keep["$ID"]=1
if [[ -n "$PREV" ]]; then keep["$PREV"]=1; fi
for r in "${all[@]}"; do
  if [[ -z "${keep[$r]:-}" ]]; then
    # Уборка не фатальна: выкладка уже прошла health. Чужие подкаталоги .next/cache (crp, umask 022)
    # crpdeploy не удалит; код 1 означал бы «сбой, выполнен откат» после успешной выкладки.
    if rm -rf "${RELEASES_DIR:?}/$r"; then
      rm -f "$STATE_DIR/build-$r.log" "$STATE_DIR/smoke-$r.log"
      log "step=cleanup удалён релиз $r"
    else
      log "не удалось удалить релиз $r"
    fi
  fi
done
live="$(mktemp)"
have="$(mktemp)"
for r in "${!keep[@]}"; do
  if [[ -d "$RELEASES_DIR/$r/.next/static" ]]; then find "$RELEASES_DIR/$r/.next/static" -type f -printf '%P\n'; fi
done | sort -u >"$live"
find "$CRP_ROOT/shared/static/_next/static" -type f -printf '%P\n' | sort >"$have"
comm -23 "$have" "$live" | while IFS= read -r f; do rm -f "$CRP_ROOT/shared/static/_next/static/$f"; done
find "$CRP_ROOT/shared/static/_next/static" -mindepth 1 -type d -empty -delete
rm -f "$live" "$have"

# 16. Итог.
log "deployed $ID sha=$SHA migrations=$pending"
