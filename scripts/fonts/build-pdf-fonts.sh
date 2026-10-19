#!/usr/bin/env bash
# Сборка статических срезов шрифтов для PDF сертификата (D-036).
#
# Зачем: react-pdf (fontkit) не умеет оси вариативных шрифтов, а в google/fonts Geologica и Onest
# лежат только вариативными. Срез Geologica фиксирует wght=700 и SHRP=100 (острота из BRAND).
#
# Что нужно: curl, sha256sum, python3 с пакетом fonttools (pip install fonttools; версия — в
# assets/fonts/pdf/README.md). python3, fonttools и pyftsubset берутся из PATH.
# Рантайму приложения ничего из этого не нужно: готовые файлы лежат в assets/fonts/pdf/.
#
# Использование:
#   scripts/fonts/build-pdf-fonts.sh              скачать исходники, собрать срезы
#   scripts/fonts/build-pdf-fonts.sh DIR          взять уже скачанные исходники из DIR
#   scripts/fonts/build-pdf-fonts.sh --verify     сверить готовые файлы с assets/fonts/pdf/SHA256SUMS
#
# Исходники сверяются с scripts/fonts/sources.sha256: подмена файла на стороне источника
# останавливает сборку. Хэши срезов зависят от версии fonttools, поэтому SHA256SUMS обновляется
# вручную после осознанной пересборки.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/assets/fonts/pdf"
SUMS="$ROOT/scripts/fonts/sources.sha256"
BASE="https://raw.githubusercontent.com/google/fonts/main/ofl"

die() { echo "build-pdf-fonts: $*" >&2; exit 1; }

if [ "${1:-}" = "--verify" ]; then
  command -v sha256sum >/dev/null || die "нужна утилита sha256sum"
  cd "$OUT" && sha256sum -c SHA256SUMS
  exit $?
fi

command -v sha256sum >/dev/null || die "нужна утилита sha256sum"
command -v python3 >/dev/null || die "python3 не найден в PATH"
python3 -c "import fontTools" 2>/dev/null || die "в python3 из PATH нет пакета fonttools (pip install fonttools)"
command -v fonttools >/dev/null || die "команда fonttools не найдена в PATH (pip install fonttools)"
command -v pyftsubset >/dev/null || die "команда pyftsubset не найдена в PATH (pip install fonttools)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SRC="${1:-}"
if [ -z "$SRC" ]; then
  command -v curl >/dev/null || die "нужна утилита curl (или передайте каталог с исходниками)"
  SRC="$WORK/src"
  mkdir -p "$SRC"
  curl -sSfL -o "$SRC/Geologica[CRSV,SHRP,slnt,wght].ttf" "$BASE/geologica/Geologica%5BCRSV%2CSHRP%2Cslnt%2Cwght%5D.ttf"
  curl -sSfL -o "$SRC/Onest[wght].ttf" "$BASE/onest/Onest%5Bwght%5D.ttf"
  curl -sSfL -o "$SRC/OFL-Geologica.txt" "$BASE/geologica/OFL.txt"
  curl -sSfL -o "$SRC/OFL-Onest.txt" "$BASE/onest/OFL.txt"
fi

(cd "$SRC" && sha256sum -c "$SUMS") || die "исходники не совпали с scripts/fonts/sources.sha256"

# Латиница, кириллица с казахскими буквами (U+0400-052F), знак тенге, пунктуация
UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0400-052F,U+1C80-1C88,U+2000-206F,U+20AC,U+20B8,U+2116,U+2122,U+2212"
FEATURES="kern,liga,calt,ccmp,locl,mark,mkmk"

mkdir -p "$OUT"

# slice <вариативный файл> <имя результата> <ось=значение>...
slice() {
  local src="$1" name="$2"
  shift 2
  local tmp="$WORK/$name"
  fonttools varLib.instancer "$src" "$@" -o "$tmp" >/dev/null
  pyftsubset "$tmp" --unicodes="$UNICODES" --layout-features="$FEATURES" --output-file="$OUT/$name"
}

slice "$SRC/Geologica[CRSV,SHRP,slnt,wght].ttf" Geologica-Bold-SHRP100.ttf wght=700 SHRP=100 CRSV=0 slnt=0
slice "$SRC/Onest[wght].ttf" Onest-Regular.ttf wght=400
slice "$SRC/Onest[wght].ttf" Onest-SemiBold.ttf wght=600

cp "$SRC/OFL-Geologica.txt" "$OUT/OFL-Geologica.txt"
cp "$SRC/OFL-Onest.txt" "$OUT/OFL-Onest.txt"

echo "Готово. Хэши результатов (внести в assets/fonts/pdf/SHA256SUMS и README):"
cd "$OUT" && sha256sum ./*.ttf ./OFL-*.txt | sed 's# \./# #'
