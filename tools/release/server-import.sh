#!/usr/bin/env bash
# Импорт релиза в исходный репозиторий сервера: только файлы, нужные для работы, без истории
# GitHub и без служебных файлов разработки (D-042). Запускает root на сервере, файл на сервере
# не хранится — передаётся на вход bash:
#   ssh <админ>@<сервер> 'sudo bash -s -- <sha> vX.Y.Z' < tools/release/server-import.sh
# После импорта: sudo -u crpdeploy /usr/local/lib/crp/deploy.sh vX.Y.Z --skip-ci-check
# (CI проверяется здесь, по исходному sha; у очищенного коммита своего CI нет).
#
# Коды выхода: 0 импортировано; 2 ошибка входа, CI, загрузки или проверки, репозиторий не тронут.
set -euo pipefail
umask 022

SRC_REPO="${CRP_SRC_REPO:-/var/lib/crp-src/crp.git}"
GH_REPO="${CRP_GH_REPO:-salemaikz/crp-kz}"
BRANCH="${CRP_SRC_BRANCH:-main}"
CI_CHECK_NAME="${CRP_CI_CHECK_NAME:-Проверки и e2e}"
# Только для тестов: локальный архив вместо загрузки с GitHub.
TARBALL="${CRP_SRC_TARBALL:-}"

# Что попадает на сервер. Всё остальное (документы, тесты, настройки редакторов) не выгружается.
SHIP=(src public messages migrations scripts deploy content assets
  package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs)

die() { echo "server-import: $2" >&2; exit "$1"; }

SHA="" TAG="" SKIP_CI=0
for arg in "$@"; do
  case "$arg" in
    --skip-ci-check) SKIP_CI=1 ;;
    -*) die 2 "неизвестный флаг $arg" ;;
    *)
      if [[ -z "$SHA" ]]; then SHA="$arg"
      elif [[ -z "$TAG" ]]; then TAG="$arg"
      else die 2 "лишний аргумент"
      fi
      ;;
  esac
done
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die 2 "Использование: server-import.sh <sha из 40 символов> vX.Y.Z [--skip-ci-check]"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]] || die 2 "тег должен быть вида vX.Y.Z"

if [[ -d "$SRC_REPO" ]] && git --git-dir="$SRC_REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  die 2 "тег $TAG уже есть в $SRC_REPO"
fi

# 1. CI по исходному sha.
if ((SKIP_CI)); then
  echo "ВНИМАНИЕ: проверка CI пропущена флагом --skip-ci-check sha=$SHA" >&2
else
  checks="$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$GH_REPO/commits/$SHA/check-runs?per_page=100")" || die 2 "не удалось получить статус CI"
  jq -e --arg n "$CI_CHECK_NAME" '[.check_runs[]? | select(.name == $n and .conclusion == "success")] | length > 0' \
    >/dev/null <<<"$checks" || die 2 "CI для $SHA не зелёный (проверка «$CI_CHECK_NAME»)"
fi

WORK="$(mktemp -d /tmp/crp-import.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
mkdir -p "$TREE"

# 2. Архив коммита без .git. На диск распаковывается только список SHIP.
if [[ -n "$TARBALL" ]]; then
  cp "$TARBALL" "$WORK/src.tgz"
else
  curl -fsSL --max-time 300 -o "$WORK/src.tgz" "https://codeload.github.com/$GH_REPO/tar.gz/$SHA" ||
    die 2 "не удалось скачать архив $SHA"
fi
# Первая строка списка; tar получит SIGPIPE от head, это не ошибка.
top="$(set +o pipefail; tar -tzf "$WORK/src.tgz" | head -n 1)"
top="${top%%/*}"
[[ -n "$top" && "$top" != . && "$top" != .. ]] || die 2 "неожиданная структура архива"
members=()
for p in "${SHIP[@]}"; do members+=("$top/$p"); done
tar -xzf "$WORK/src.tgz" -C "$TREE" --strip-components=1 --no-same-owner "${members[@]}" ||
  die 2 "в архиве нет части файлов из списка выгрузки"
rm -f "$WORK/src.tgz"

# 3. Служебные пометки разработки в комментариях заменяются нейтральными.
mapfile -d '' text_files < <(cd "$TREE" && grep -rlIZ -e 'ИИ-шум' -e 'перепишут агенты' . || true)
for f in "${text_files[@]}"; do
  sed -i -e 's/ИИ-шум/визуального шум/g' -e 's/ (страницы перепишут агенты фич)//g' "$TREE/$f"
done

# 4. Проверка: в выгрузке не осталось следов инструментов разработки. Найдено — импорт отменяется,
# правило замены добавляется в шаг 3 (или файл исключается из SHIP).
TRACE_RE='claude|anthropic|codex|openai|chatgpt|copilot|co-authored-by|generated (by|with)|slop|handoff|оркестратор|подагент|ИИ-шум|агенты фич'
if hits="$(cd "$TREE" && grep -rniIE "$TRACE_RE" . | head -n 20)" && [[ -n "$hits" ]]; then
  echo "$hits" >&2
  die 2 "в выгрузке остались служебные пометки разработки"
fi
if names="$(cd "$TREE" && find . -iregex '.*\(claude\|codex\|copilot\|cursor\|agents\|handoff\).*' | head -n 20)" &&
  [[ -n "$names" ]]; then
  echo "$names" >&2
  die 2 "в выгрузке остались служебные файлы разработки"
fi

# 5. Коммит в исходный репозиторий сервера: нейтральный автор, история только из релизов.
if [[ ! -d "$SRC_REPO" ]]; then
  install -d -m 0755 "$(dirname "$SRC_REPO")"
  git init -q --bare --initial-branch="$BRANCH" "$SRC_REPO"
fi
export GIT_DIR="$SRC_REPO" GIT_WORK_TREE="$TREE" GIT_INDEX_FILE="$WORK/index"
export GIT_AUTHOR_NAME=release GIT_AUTHOR_EMAIL=release@localhost
export GIT_COMMITTER_NAME=release GIT_COMMITTER_EMAIL=release@localhost
git add -A
tree_sha="$(git write-tree)"
parent="$(git rev-parse -q --verify "refs/heads/$BRANCH" || true)"
commit="$(git commit-tree "$tree_sha" ${parent:+-p "$parent"} -m "release $TAG" -m "source $SHA")"
git update-ref "refs/heads/$BRANCH" "$commit" ${parent:+"$parent"}
git update-ref "refs/tags/$TAG" "$commit" ""
echo "импортировано: $TAG -> $commit (источник $SHA)"
