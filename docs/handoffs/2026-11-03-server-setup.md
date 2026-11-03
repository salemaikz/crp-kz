# Передача: первая установка сервера ЦРП (локальная сессия на машине владельца)

Дата: 2026-11-03. Поток: эксплуатация (`deploy/`, `docs/ops/`, `tools/release/`).

## Для кого и зачем

Облачная сессия не может зайти на сервер: из её контейнера SSH (порт 22) закрыт. Установку
ведёт сессия Claude Code на Mac владельца в папке `crp deploy`. С Mac SSH до сервера работает.
Правила репозитория (`AGENTS.md`) той сессии не загружены, поэтому всё нужное собрано здесь.

Сервер: Ubuntu 24.04, 8 ГБ памяти. IP и одноразовый пароль root владелец даёт в чате локальной
сессии. **В репозиторий, коммиты и issue их не писать** (репозиторий публичный).

## Что уже сделано (ветка `claude/epic-lamport-ixbraa`)

- D-042: на сервере нет клона GitHub. Код приходит очищенным снимком через
  `tools/release/server-import.sh`: только файлы для работы, без истории и служебных файлов
  разработки, нейтральный автор. Скрипт проверяет, что коммит есть в ветке репозитория, и отменяет
  импорт, если находит следы. RUNBOOK (разделы 2 и 4) обновлён под эту схему.
- Проверки коммита в облаке: `tsc`, `lint`, unit (539 прошло, 1 пропуск: нет shellcheck),
  интеграционные на PGlite (481 прошло, 16 пропусков: нужен настоящий Postgres), `next build`.
  CI на GitHub для веток `claude/*` не запускается (только `main` и PR), поэтому импорт идёт с
  `--skip-ci-check`, причина: проверки выше.

## Правила для локальной сессии

1. Секреты не выводить в чат и не печатать в терминал: пароли БД, `SESSION_SECRET`, ключи
   генерируются на сервере и сразу пишутся в `/etc/crp/*.env`. Значения не показывать.
2. Всё, что владелец должен сохранить (пароль root для консоли хостера, приватный ключ age,
   пароль первого администратора), — только в файл `crp deploy/секреты-сервера.txt` с правами
   0600, без вывода на экран. В конце напомнить владельцу перенести в менеджер паролей и удалить файл.
3. Вход по паролю не отключать, пока не проверен вход по ключу в **новом** соединении.
4. На сервер не копировать ничего из папки `crp deploy` и из клона репозитория: код идёт только
   через импорт (шаг 6). Имя ветки репозитория в командах на сервере не указывать: импорт с
   `--any-branch` найдёт её сам (основная ветка ещё не готова, D-042).
5. Каждый шаг заканчивается проверкой. Не прошла — остановиться и показать владельцу вывод.
   SSH-соединения при обрыве не повторять подряд: после 5 неудач fail2ban банит адрес на 10 минут.
7. В блоках ниже `<IP>` и `<SHA>` подставить перед запуском, в том числе внутри heredoc.
6. Порядок и права — по `docs/ops/RUNBOOK.md`, раздел 2. Ниже — конкретные значения для этого сервера.

Обозначения: `<IP>` — адрес сервера, `<SHA>` — последний коммит ветки
(`git ls-remote https://github.com/salemaikz/crp-kz refs/heads/claude/epic-lamport-ixbraa`),
тег первого релиза `v0.1.0`, администратор ОС `crpadmin`.

## Шаги

### 0. Ключ на Mac

```bash
test -f ~/.ssh/crp_server || ssh-keygen -t ed25519 -N "" -C crp-server -f ~/.ssh/crp_server
```

В `~/.ssh/config` добавить (`<IP>` подставить):

```
Host crp
  HostName <IP>
  User crpadmin
  IdentityFile ~/.ssh/crp_server
  IdentitiesOnly yes
Host crp-root
  HostName <IP>
  User root
  IdentityFile ~/.ssh/crp_server
  IdentitiesOnly yes
```

### 1. Первый вход по паролю: положить ключ root

Пароль передаётся через `SSH_ASKPASS` из временного файла 0700, файл сразу удаляется. Хост-ключ
принимается при первом входе (`accept-new`), его отпечаток показать владельцу.

```bash
ap="$(mktemp)"; chmod 700 "$ap"; printf '#!/bin/sh\nprintf "%%s\\n" "$CRP_PW"\n' >"$ap"
CRP_PW='<пароль root>' SSH_ASKPASS="$ap" SSH_ASKPASS_REQUIRE=force DISPLAY=none \
  ssh -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no -o PreferredAuthentications=password \
  root@<IP> 'install -d -m 700 /root/.ssh && cat >>/root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys' \
  <~/.ssh/crp_server.pub
rm -f "$ap"
```

Проверка: `ssh -o BatchMode=yes crp-root true` без пароля, код 0.
Если сервер требует сменить пароль при первом входе, остановиться и сказать владельцу.

### 2. База (от root по ключу)

```bash
ssh crp-root 'bash -s' <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
timedatectl set-timezone UTC
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ufw fail2ban unattended-upgrades
id crpadmin >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups sudo crpadmin
install -d -m 700 -o crpadmin -g crpadmin /home/crpadmin/.ssh
grep 'crp-server$' /root/.ssh/authorized_keys >/home/crpadmin/.ssh/authorized_keys
chown crpadmin:crpadmin /home/crpadmin/.ssh/authorized_keys; chmod 600 /home/crpadmin/.ssh/authorized_keys
echo 'crpadmin ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-crpadmin; chmod 440 /etc/sudoers.d/90-crpadmin
visudo -cf /etc/sudoers.d/90-crpadmin
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable
systemctl enable --now fail2ban unattended-upgrades
EOF
```

Sudo без пароля нужен импорту (шаг 6): он идёт через `sudo` без tty.
Проверки: `ssh -o BatchMode=yes crp 'sudo -n true && echo ok'`; `ssh crp 'sudo fail2ban-client status sshd'`.
Если `ssh crp 'test -f /var/run/reboot-required && echo нужна-перезагрузка'` что-то вывел:
`ssh crp 'sudo systemctl reboot'`, подождать минуту, `ssh crp uptime`.

### 3. Закрыть вход по паролю и под root

```bash
ssh crp 'sudo bash -s' <<'EOF'
set -euo pipefail
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' >/etc/ssh/sshd_config.d/00-crp-hardening.conf
sshd -t
systemctl reload ssh
EOF
```

Проверки (в новых соединениях):
- `ssh crp 'sudo sshd -T | grep -Ei "^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) "'`
  даёт три строки со значением `no`;
- `ssh -o BatchMode=yes -o PubkeyAuthentication=no crpadmin@<IP> true 2>&1 | grep -o 'Permission denied (.*)'`
  даёт ровно `Permission denied (publickey)` (без `password`);
- `ssh crp 'sudo -n true && echo ok'` работает.

Только после этого удалить ключ root и сменить пароль root (он нужен только для консоли хостера).
Новый пароль идёт сразу в файл, на экран не печатается; при любой ошибке пароль не меняется и в
файл не пишется:

```bash
ssh crp 'sudo rm /root/.ssh/authorized_keys'
(umask 077; ssh crp 'set -e; p=$(openssl rand -base64 18); [ ${#p} -ge 20 ]; echo "root:$p" | sudo chpasswd; echo "пароль root (консоль хостера): $p"' >>"секреты-сервера.txt")
grep -c 'пароль root' "секреты-сервера.txt"
```

Блок `crp-root` из `~/.ssh/config` удалить.

### 4. Пакеты

```bash
ssh crp 'sudo bash -s' <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh; rm -f /tmp/nodesource_setup.sh
apt-get -y -q install nodejs git nginx certbot python3-certbot-nginx age rsync jq acl postgresql-16
npm i -g "pm2@$(npm view pm2 version)"
node -v; pm2 -v; psql --version
EOF
```

Версию pm2 записать в отчёт владельцу (RUNBOOK требует точную версию).

### 5. Пользователи и корень (RUNBOOK 2.5)

```bash
ssh crp 'sudo bash -s' <<'EOF'
set -euo pipefail
id crp >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin crp
id crpdeploy >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin --groups crp crpdeploy
install -d -m 0751 -o crpdeploy -g crp /srv/crp
EOF
```

### 6. Импорт кода (D-042, RUNBOOK 4, шаг 0)

Скрипт берётся с GitHub по sha и сразу идёт в `bash`, на диске сервера не остаётся. `--any-branch`:
коммит пока в рабочей ветке, а не в основной (D-042). `--skip-ci-check`: CI для этой ветки не
запускался, проверки прогнаны в облаке (см. выше).

```bash
ssh crp "set -o pipefail; curl -fsSL https://raw.githubusercontent.com/salemaikz/crp-kz/<SHA>/tools/release/server-import.sh | sudo bash -s -- <SHA> v0.1.0 --any-branch --skip-ci-check"
```

Успех — только строка «импортировано: v0.1.0 -> <sha снимка>». Нет этой строки — ошибка, даже
если код 0. Запомнить sha снимка.
Проверка: `ssh crp 'sudo git --git-dir=/var/lib/crp-src/crp.git log --format="%an %s" -1; sudo git --git-dir=/var/lib/crp-src/crp.git ls-tree --name-only main'`:
автор `release`, в корне только `assets content deploy docs messages migrations next.config.ts package*.json postcss.config.mjs public scripts src tsconfig.json`.

### 7. Зеркало для выкладки и выгрузка комплекта для root

```bash
ssh crp 'sudo bash -s' <<'EOF'
set -euo pipefail
sudo -u crpdeploy git config --global --add safe.directory /var/lib/crp-src/crp.git
[ -d /srv/crp/repo.git ] || sudo -u crpdeploy git clone -q --mirror /var/lib/crp-src/crp.git /srv/crp/repo.git
d=$(mktemp -d /tmp/crp-deploy.XXXXXX); chmod 0755 "$d"
git clone -q --depth 1 --branch v0.1.0 file:///var/lib/crp-src/crp.git "$d/crp"
echo "$d"; git -C "$d/crp" rev-parse HEAD
EOF
```

sha выгрузки должен совпасть с sha снимка из шага 6. Выгрузка `/tmp/crp-deploy.*/crp` нужна в
шагах 8–10 и должна быть одна (`ssh crp 'ls -d /tmp/crp-deploy.*'`).

### 8. Postgres: настройки и роли (RUNBOOK 2.6 и 2.7)

```bash
ssh crp 'sudo bash -s' <<'EOF'
set -euo pipefail
K=$(ls -d /tmp/crp-deploy.*/crp); [ "$(printf '%s\n' "$K" | wc -l)" -eq 1 ]
c=/etc/postgresql/16/main
install -m 0644 "$K/deploy/postgres/postgresql.conf.d/crp.conf" "$c/conf.d/crp.conf"
echo 'shared_buffers = 2GB' >>"$c/conf.d/crp.conf"
[ -f "$c/pg_hba.conf.orig" ] || cp -p "$c/pg_hba.conf" "$c/pg_hba.conf.orig"
install -m 0640 -o postgres -g postgres "$K/deploy/postgres/pg_hba.snippet" "$c/pg_hba.conf"
systemctl restart postgresql
cd /tmp
sudo -u postgres psql -tAc 'show ssl'
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v db=crp -v owner=crp_owner -v app=crp_app -f "$K/deploy/postgres/roles.sql"
sudo -u postgres psql -tAc "select rolname from pg_roles where rolname like 'crp_%' order by 1"
EOF
```

Проверка: `show ssl` даёт `on`, роли `crp_app` и `crp_owner` есть. Пароли ролей задаются в шаге 10.

### 9. Комплект эксплуатации

```bash
ssh crp 'K=$(ls -d /tmp/crp-deploy.*/crp); sudo bash "$K/deploy/bin/install-ops.sh" --domain <IP>'
```

Домена пока нет, IP проходит проверку формата. Ожидается «сертификата ещё нет: установлен только
порт 80». Без сертификата nginx на порту 80 отдаёт только редирект на https, поэтому снаружи сайт
пока не открывается. Это ожидаемо.

### 10. Пароли ролей и файлы `/etc/crp` (RUNBOOK 2.10, права из раздела 1)

Один скрипт: генерирует секреты, задаёт пароли ролей через stdin psql (с
`log_min_error_statement = panic`, чтобы при ошибке пароль не попал в журнал Postgres) и пишет
env-файлы по шаблонам. Значения не печатаются. Повторный запуск отказывает, если `app.env` уже есть.

```bash
ssh crp 'sudo bash -s' <<'EOF'
set -euo pipefail
IP='<IP>'
K=$(ls -d /tmp/crp-deploy.*/crp); [ "$(printf '%s\n' "$K" | wc -l)" -eq 1 ]
E="$K/deploy/env"
[ -d /etc/crp ] || { echo "нет /etc/crp: сначала шаг 9"; exit 2; }
[ ! -e /etc/crp/app.env ] || { echo "/etc/crp/app.env уже есть, остановка"; exit 2; }
umask 077
own=$(openssl rand -hex 24); app=$(openssl rand -hex 24)
ss=$(openssl rand -base64 48); ak=$(openssl rand -base64 32)
[ ${#own} -eq 48 ] && [ ${#app} -eq 48 ] && [ ${#ss} -ge 60 ] && [ ${#ak} -ge 40 ]
cd /tmp
sudo -u postgres psql -q -v ON_ERROR_STOP=1 <<SQL
SET log_min_error_statement = panic;
ALTER ROLE crp_owner PASSWORD '$own';
ALTER ROLE crp_app PASSWORD '$app';
SQL
sed -e "s|<пароль-crp_app>|$app|" -e "s|<openssl-rand-base64-48>|$ss|" \
    -e "s|<openssl-rand-base64-32>|$ak|" -e "s|https://<домен>|https://$IP|" "$E/app.env.example" >/etc/crp/app.env
sed -e "s|<пароль-crp_owner>|$own|" "$E/migrate.env.example" >/etc/crp/migrate.env
sed -e "s|<домен>|$IP|" "$E/monitor.env.example" >/etc/crp/monitor.env
cp "$E/backup.env.example" /etc/crp/backup.env
chown root:crp /etc/crp/app.env /etc/crp/monitor.env; chmod 0640 /etc/crp/app.env /etc/crp/monitor.env
chown root:crpdeploy /etc/crp/migrate.env; chmod 0640 /etc/crp/migrate.env
chown root:root /etc/crp/backup.env; chmod 0644 /etc/crp/backup.env
if grep -H -v '^#' /etc/crp/app.env /etc/crp/migrate.env /etc/crp/monitor.env | grep '<'; then
  echo "остались заглушки"; exit 2
fi
stat -c '%U:%G %a %n' /etc/crp/*
EOF
```

Флаги функций остаются как в шаблоне (все 0). Если строка с заглушкой всё же вывелась, в ней
может быть секрет: владельцу её не пересылать, исправить файл на сервере.

### 11. Ключ age для бэкапов (временное решение до D-029)

Без открытого ключа первая выкладка остановится на бэкапе (код 2). Пока владелец не назначил
хранителей, хранитель один — владелец. Приватный ключ создаётся на Mac и на сервер не попадает
(`deploy/env/backup-recipients.example`):

```bash
command -v age-keygen >/dev/null || brew install age
[ -e "age-ключ-бэкапов.txt" ] || (umask 077; age-keygen -o "age-ключ-бэкапов.txt" 2>/dev/null)
age-keygen -y "age-ключ-бэкапов.txt" | ssh crp 'sudo install -m 0644 -o root -g root /dev/stdin /etc/crp/backup-recipients.txt && sudo cat /etc/crp/backup-recipients.txt'
```

Выводится только открытый ключ `age1...` (не секрет). Если Homebrew нет, остановиться и спросить
владельца, а не создавать ключ на сервере. Без приватного ключа бэкапы не расшифровать: владельцу
сразу сохранить `age-ключ-бэкапов.txt` в менеджер паролей.

### 12. Первая выкладка (RUNBOOK 2.12, раздел 4)

```bash
ssh crp 'sudo -u crpdeploy /usr/local/lib/crp/deploy.sh v0.1.0 --skip-ci-check; echo "код $?"'
```

Идёт несколько минут (`npm ci`, сборка). Код 0 означает успех. Код 2 означает, что прод не тронут:
смотреть `/srv/crp/shared/state/deploy.log` и `build-*.log` там же, показать владельцу хвост и
причину. Чинить можно только окружение на сервере. Код приложения не менять: правка идёт в
репозиторий и новым импортом.

### 13. Автозапуск и проверка

```bash
ssh crp 'sudo -u crp -H pm2 startup systemd -u crp --hp /home/crp'
```

pm2 выведет строку `sudo env PATH=... pm2 startup systemd -u crp --hp /home/crp`: выполнить её через
`ssh crp '<эта строка>'`, затем `ssh crp 'sudo -u crp -H pm2 save'`.

- `ssh crp 'curl -fsS http://127.0.0.1:3000/api/health'`: `status` = `ok`, `release` = id релиза.
- Сайт с Mac через туннель: `ssh -N -L 3000:127.0.0.1:3000 crp`, затем в браузере
  `http://localhost:3000/ru`.
- Удалить выгрузку из шага 7: `ssh crp 'sudo rm -r /tmp/crp-deploy.*'`.

### 14. Следов разработки на сервере нет

```bash
ssh crp "sudo grep -rIil -E 'claude|anthropic|codex|copilot|co-authored' /srv/crp /var/lib/crp-src /usr/local/lib/crp /etc/crp /etc/nginx /etc/cron.d --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=static 2>/dev/null; sudo grep -il claude /var/log/auth.log; echo конец"
```

Ожидается только «конец». Находка в `node_modules`, `.next` или `shared/static` (сторонние пакеты и
собранные чанки) следом разработки не считается. Если что-то найдено вне них, показать владельцу
и не чистить вручную.

### 15. Первый администратор — после домена

Вход в production работает только по HTTPS (cookie `Secure`). Через туннель на `localhost`
браузер их тоже принимает, но адрес в письмах и QR вшит при сборке (`NEXT_PUBLIC_SITE_URL`).
Администратора создать по RUNBOOK, раздел 3, когда владелец скажет почту и имя. Пароль
сгенерировать, передать в `create-admin` через stdin и записать только в `секреты-сервера.txt`.

## Что осталось владельцу

1. Домен: A-запись на `<IP>`. Затем `certbot certonly --webroot -w /var/www/certbot -d <домен>`,
   повторно `install-ops.sh --domain <домен>`, в `/etc/crp/app.env` и `monitor.env` поменять адрес на
   домен и выложить тот же тег заново (адрес вшивается при сборке).
2. D-029: хранители ключей age (сейчас один — владелец) и вторая копия бэкапов в РК.
3. Канал алертов (`monitor.env`).
4. Перенести `секреты-сервера.txt` и `age-ключ-бэкапов.txt` в менеджер паролей и удалить файлы.
5. Влить ветку `claude/epic-lamport-ixbraa` в основную. Следующие релизы — с CI на `main`, без
   `--skip-ci-check` у импорта.

## Отчёт облачной сессии

По завершении локальная сессия пишет владельцу короткий отчёт без секретов и IP: что сделано,
версии Node, pm2 и Postgres, sha снимка, код выкладки, ответ `/api/health`, результат шага 14.
Владелец пересылает его в облачную сессию, она обновит RUNBOOK по фактам.
