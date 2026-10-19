# Шрифты PDF сертификата

Статические срезы для `@react-pdf/renderer` (D-036). Брендовые шрифты ЦРП — Geologica и Onest,
лицензия SIL OFL 1.1, Reserved Font Name у обоих нет.

| Файл | Срез |
|---|---|
| `Geologica-Bold-SHRP100.ttf` | Geologica, wght=700, SHRP=100, CRSV=0, slnt=0 |
| `Onest-Regular.ttf` | Onest, wght=400 |
| `Onest-SemiBold.ttf` | Onest, wght=600 |
| `OFL-Geologica.txt`, `OFL-Onest.txt` | лицензии, копии `OFL.txt` из каталогов шрифтов |

Почему не вариативные файлы: react-pdf (fontkit) не задаёт оси вариативного шрифта, поэтому
«острота» SHRP=100 из BRAND запекается в файл. Состав символов: латиница, кириллица с казахскими
буквами (`U+0400-052F`), знак тенге `U+20B8`, номер `U+2116`, общая пунктуация.

## Источник

Репозиторий google/fonts, ветка `main`, каталоги `ofl/geologica` и `ofl/onest`:

- `Geologica[CRSV,SHRP,slnt,wght].ttf`
- `Onest[wght].ttf`
- `OFL.txt` из каждого каталога

Источник закреплён не коммитом, а хэшем файлов: SHA-256 исходников лежат в
`scripts/fonts/sources.sha256`, сборка останавливается, если файл на стороне источника изменился.

| Исходник | SHA-256 |
|---|---|
| Geologica[CRSV,SHRP,slnt,wght].ttf | `9124d9e88ac6c11d761f35241713a51d68e2c4ebedce0edaca834717a00959ec` |
| Onest[wght].ttf | `966c5c29b4755da84b6854d5c21dd4eaa2420225d0e9874de602de176d4a9f31` |
| OFL.txt (Geologica) | `778186245840aea0e60bec6a46e7fb1442e0cd78e41afeadffcd3e8824b379e0` |
| OFL.txt (Onest) | `071195d8806e226faeee60259c28ca67b458227af5195a73f5cfcab06e3003bc` |

## Результаты

Хэши срезов — в `SHA256SUMS` (проверка: `scripts/fonts/build-pdf-fonts.sh --verify`).

| Файл | SHA-256 |
|---|---|
| `Geologica-Bold-SHRP100.ttf` | `919e561ed86d7cc8d6d9bb47d4bdfea714da850c2ef2dd1f442bb333f0931f76` |
| `Onest-Regular.ttf` | `47681531e1d015b340bc90a49ad6f1d3ca890e0de234f02ff7da9f898d981ecf` |
| `Onest-SemiBold.ttf` | `08297139e4dfe85408f9342a246a6100abbe361daaa2906e916923581b76cb3b` |

## Пересборка

Нужны `curl`, `sha256sum`, `python3` и пакет `fonttools` (срезы собраны на 4.55.3) в `PATH`:

```sh
pip install fonttools==4.55.3
scripts/fonts/build-pdf-fonts.sh            # скачивает исходники и собирает срезы
scripts/fonts/build-pdf-fonts.sh <каталог>  # исходники уже скачаны
```

Другая версия fonttools может дать другие байты: хэши срезов тогда обновляются в `SHA256SUMS` и
в этой таблице осознанно, отдельным коммитом. Приложению fonttools не нужен, оно читает готовые файлы.
