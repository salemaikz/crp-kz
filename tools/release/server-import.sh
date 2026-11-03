#!/usr/bin/env bash
# Импорт релиза в исходный репозиторий сервера: только файлы, нужные для работы, без истории
# GitHub и без служебных файлов разработки (D-042). Запускает root на сервере, файл на сервере
# не хранится, а передаётся на вход bash. Нужен вход root по ключу или sudo без пароля: без tty
# sudo пароль не спросит.
#   ssh <админ>@<сервер> 'sudo bash -s -- <sha> vX.Y.Z' < tools/release/server-import.sh
# Флаги: --branch <ветка GitHub> (коммит обязан входить в неё; без флага подходит любая ветка
# репозитория, сначала проверяется ветка по умолчанию), --skip-ci-check (только если CI для коммита
# не запускался).
# После импорта: sudo -u crpdeploy /usr/local/lib/crp/deploy.sh vX.Y.Z --skip-ci-check
# (CI проверяется здесь, по исходному sha; у очищенного коммита своего CI нет).
#
# Коды выхода: 0 импортировано; 2 любая ошибка, репозиторий сервера не тронут.

# Тело в функции: bash дочитывает скрипт целиком до запуска, оборванная передача не выполнится наполовину.
main() {
  set -Eeuo pipefail
  trap 'exit 2' ERR
  umask 022
  # Регистронезависимый поиск по кириллице не должен зависеть от локали оператора.
  export LC_ALL=C.UTF-8
  # Настройки git у root не влияют на снимок (исключения, атрибуты, подпись).
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null

  local SRC_REPO="${CRP_SRC_REPO:-/var/lib/crp-src/crp.git}"
  local GH_REPO="${CRP_GH_REPO:-salemaikz/crp-kz}"
  local CI_CHECK_NAME="${CRP_CI_CHECK_NAME:-Проверки и e2e}"
  # Ветка исходного репозитория сервера; deployBranch в instance.json должен совпадать.
  local SRV_BRANCH=main
  # Только для тестов: локальный архив вместо GitHub, проверки ветки и CI не выполняются.
  local TARBALL="${CRP_SRC_TARBALL:-}"

  # Что попадает на сервер. Всё остальное (документы, тесты, настройки редакторов) не выгружается.
  # Файлы, которые приложение читает с диска, перечислены в outputFileTracingIncludes (next.config.ts).
  local SHIP=(src public messages migrations scripts deploy content assets
    docs/brand/logo/crp-logo.png
    package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs)

  local SHA="" TAG="" GH_BRANCH="" SKIP_CI=0
  while (($#)); do
    case "$1" in
      --skip-ci-check) SKIP_CI=1; shift ;;
      --branch) GH_BRANCH="${2:-}"; shift 2 || die "после --branch нужно имя ветки" ;;
      -*) die "неизвестный флаг $1" ;;
      *)
        if [[ -z "$SHA" ]]; then SHA="$1"
        elif [[ -z "$TAG" ]]; then TAG="$1"
        else die "лишний аргумент"
        fi
        shift
        ;;
    esac
  done
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "Использование: server-import.sh <sha из 40 символов> vX.Y.Z [--branch <ветка>] [--skip-ci-check]"
  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]] || die "тег должен быть вида vX.Y.Z"
  [[ -z "$GH_BRANCH" || "$GH_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "недопустимое имя ветки"

  if [[ -e "$SRC_REPO" ]]; then
    [[ "$(git --git-dir="$SRC_REPO" rev-parse --is-bare-repository 2>/dev/null)" == true ]] ||
      die "$SRC_REPO существует, но это не bare-репозиторий"
    if git --git-dir="$SRC_REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
      die "тег $TAG уже есть в $SRC_REPO"
    fi
  fi

  local WORK
  WORK="$(mktemp -d /tmp/crp-import.XXXXXX)"
  # shellcheck disable=SC2064 # путь подставляется сейчас: после выхода из main локальной переменной нет
  trap "rm -rf '$WORK'" EXIT
  local TREE="$WORK/tree"
  mkdir -p "$TREE"

  if [[ -n "$TARBALL" ]]; then
    echo "ТЕСТ: локальный архив, проверки ветки и CI не выполняются" >&2
    cp "$TARBALL" "$WORK/src.tgz"
  else
    # 1. Только код из ветки официального репозитория. Архив и API GitHub отдают и коммиты форков,
    # поэтому sha обязан входить в ветку репозитория: заданную --branch, иначе в ветку по умолчанию
    # или в любую другую (ветку создаёт только тот, у кого есть запись). Имя ветки в аргументах не
    # нужно, и в журнал sudo на сервере оно не попадает.
    local branches=() b status found=""
    if [[ -n "$GH_BRANCH" ]]; then
      branches=("$GH_BRANCH")
    else
      b="$(gh_api "repos/$GH_REPO" | jq -er '.default_branch')" || die "не удалось узнать ветку по умолчанию"
      branches=("$b")
      gh_api "repos/$GH_REPO/branches?per_page=100" >"$WORK/branches.json" || die "не удалось получить список веток"
      while IFS= read -r b; do
        [[ "$b" =~ ^[A-Za-z0-9._/-]+$ && "$b" != "${branches[0]}" ]] && branches+=("$b")
      done < <(jq -r '.[].name' "$WORK/branches.json")
    fi
    for b in "${branches[@]}"; do
      status="$(gh_api "repos/$GH_REPO/compare/$SHA...$b" | jq -er '.status')" ||
        die "не удалось сравнить $SHA с веткой $b"
      if [[ "$status" == identical || "$status" == ahead ]]; then found="$b"; break; fi
    done
    [[ -n "$found" ]] || die "коммит $SHA не входит ни в одну проверенную ветку репозитория $GH_REPO"
    echo "коммит входит в ветку $found"

    # 2. CI по исходному sha.
    if ((SKIP_CI)); then
      echo "ВНИМАНИЕ: проверка CI пропущена флагом --skip-ci-check sha=$SHA" >&2
    else
      gh_api "repos/$GH_REPO/commits/$SHA/check-runs?per_page=100" >"$WORK/checks.json" ||
        die "не удалось получить статус CI"
      jq -e --arg n "$CI_CHECK_NAME" '[.check_runs[]? | select(.name == $n and .conclusion == "success")] | length > 0' \
        "$WORK/checks.json" >/dev/null || die "CI для $SHA не зелёный (проверка «$CI_CHECK_NAME»)"
    fi

    # 3. Архив коммита без .git.
    curl -fsSL --max-time 300 -o "$WORK/src.tgz" "https://codeload.github.com/$GH_REPO/tar.gz/$SHA" ||
      die "не удалось скачать архив $SHA"
  fi

  # 4. На диск распаковывается только список SHIP.
  local top
  # Первая строка списка; tar получит SIGPIPE от head, это не ошибка.
  top="$(set +o pipefail; tar -tzf "$WORK/src.tgz" | head -n 1)"
  top="${top%%/*}"
  [[ -n "$top" && "$top" != . && "$top" != .. ]] || die "неожиданная структура архива"
  local members=() p
  for p in "${SHIP[@]}"; do members+=("$top/$p"); done
  tar -xzf "$WORK/src.tgz" -C "$TREE" --strip-components=1 --no-same-owner "${members[@]}" ||
    die "в архиве нет части файлов из списка выгрузки"
  rm -f "$WORK/src.tgz"

  # 5. Служебные пометки разработки в комментариях заменяются нейтральными.
  local text_files=() f
  mapfile -d '' text_files < <(cd "$TREE" && grep -rlIZ -e 'ИИ-шум' -e 'перепишут агенты' . || true)
  for f in "${text_files[@]}"; do
    sed -i -e 's/ИИ-шум/визуального шум/g' -e 's/ (страницы перепишут агенты фич)//g' "$TREE/$f"
  done

  # 6. Проверка: следов инструментов разработки не осталось. Найдено — импорт отменяется, правило
  # замены добавляется в шаг 5 (или файл исключается из SHIP). Вывод идёт в файл: код grep
  # разбирается явно, обрезка вывода не должна превращать находку в «чисто».
  local TRACE_RE='claude|anthropic|codex|openai|chatgpt|copilot|agents\.md|co-authored-by|generated (by|with)|slop|handoff|оркестратор|подагент|ИИ-шум|агенты фич'
  local rc=0
  (cd "$TREE" && grep -rniIE "$TRACE_RE" .) >"$WORK/hits" || rc=$?
  case "$rc" in
    0) head -n 20 "$WORK/hits" >&2; die "в выгрузке остались служебные пометки разработки" ;;
    1) ;;
    *) die "проверка выгрузки не удалась (grep, код $rc)" ;;
  esac
  (cd "$TREE" && find . -iregex '.*\(claude\|codex\|copilot\|cursor\|agents\|handoff\).*') >"$WORK/names"
  if [[ -s "$WORK/names" ]]; then
    head -n 20 "$WORK/names" >&2
    die "в выгрузке остались служебные файлы разработки"
  fi

  # 7. Коммит в исходный репозиторий сервера: нейтральный автор, история только из релизов.
  if [[ ! -e "$SRC_REPO" ]]; then
    install -d -m 0755 "$(dirname "$SRC_REPO")"
    git init -q --bare --initial-branch="$SRV_BRANCH" "$SRC_REPO"
  fi
  export GIT_DIR="$SRC_REPO" GIT_WORK_TREE="$TREE" GIT_INDEX_FILE="$WORK/index"
  export GIT_AUTHOR_NAME=release GIT_AUTHOR_EMAIL=release@localhost
  export GIT_COMMITTER_NAME=release GIT_COMMITTER_EMAIL=release@localhost
  git add -A -f
  local tree_sha parent commit zero
  tree_sha="$(git write-tree)"
  zero="$(git hash-object --stdin </dev/null | tr '0-9a-f' '0')"
  parent="$(git rev-parse -q --verify "refs/heads/$SRV_BRANCH" || true)"
  commit="$(git commit-tree "$tree_sha" ${parent:+-p "$parent"} -m "release $TAG" -m "source $SHA")"
  # Ветка и тег меняются одной транзакцией: либо оба, либо ничего.
  printf 'start\nupdate refs/heads/%s %s %s\ncreate refs/tags/%s %s\nprepare\ncommit\n' \
    "$SRV_BRANCH" "$commit" "${parent:-$zero}" "$TAG" "$commit" | git update-ref --stdin >/dev/null ||
    die "не удалось обновить ветку и тег (параллельный импорт?)"
  echo "импортировано: $TAG -> $commit (источник $SHA)"
}

die() { echo "server-import: $1" >&2; exit 2; }

gh_api() {
  curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' "https://api.github.com/$1"
}

main "$@"
