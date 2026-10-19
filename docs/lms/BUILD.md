# Сборка MVP — технический контракт

Документ для агентов, которые строят платформу. Он **нормативный**, как
`AGENTS.md` и `SPEC.md`. Расхождение кода с ним — баг. Менять контракт может
только оркестратор, отдельным коммитом.

Цель первой сборки — рабочая платформа, которую владелец откроет по ссылке и
пройдёт сам. Нужны:
- витрина и курсы;
- урок с тестом и сертификат;
- покупка через подтверждение админом;
- назначения сотрудникам и отчёт руководителя;
- конструктор курсов в админке.

Вне этой сборки: эквайринг, B2B-места, задания с наставником, расписание
уроков, ИИ.

## 1. Стек и версии (pin)

| Пакет | Версия |
|---|---|
| next / eslint-config-next | 16.4.2 |
| react, react-dom | 19.3.1 |
| typescript | 5.9.3 (не 7.x) |
| eslint | 10.13.0 |
| tailwindcss, @tailwindcss/postcss | 4.3.3 |
| next-intl | 4.14.9 |
| postgres (postgres.js) | 3.4.9 |
| @electric-sql/pglite | 0.5.10 |
| zod | 3.25.76 |
| bcryptjs | 3.0.3 |
| react-markdown / remark-gfm | 10.1.0 / 4.0.1 |
| qrcode (+ @types/qrcode) | 1.5.4 |
| lucide-react | 1.59.0 |
| @playwright/test | 1.56.1 (браузер: `/opt/pw-browsers/chromium-1194`) |
| tsx | 4.23.15 |

- Node 22, ESM.
- Сборка `next build --webpack`, не Turbopack.
- Новые зависимости добавляет **только оркестратор**. Агенты фич не трогают
  `package.json`.

## 2. База данных: один интерфейс, два драйвера

`src/lib/db/index.ts`:

```ts
export type Row = Record<string, unknown>;
export interface Sql {
  <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
}
export interface Db {
  sql: Sql;
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  json(value: unknown): unknown;  // параметр для колонок jsonb: ${db.json(v)}
  driver: 'postgres' | 'pglite';
}
export async function getDb(): Promise<Db>;  // ленивая инициализация + миграции + сид
export function newId(): string;             // crypto.randomUUID()
export function now(): number;               // Date.now()
```

**Выбор драйвера.**
- Есть `DATABASE_URL` — используется postgres.js. В camelCase переводятся только
  **имена колонок** (`transform: { column: { from: postgres.toCamel } }`); содержимое
  jsonb не трогается и читается ровно как записано. Строки — обычные объекты
  (не объекты postgres.js без прототипа); int8 → number.
- Нет — PGlite: in-memory, либо файл `PGLITE_DIR`, если он задан.

**Демо-режим** (`isDemo()` в `src/lib/env.ts`) включается только явно:
`DEMO_MODE=1`, либо локальная разработка и тесты без `DATABASE_URL`
(`NODE_ENV` не `production`). В production без `DATABASE_URL` и без
`DEMO_MODE=1` инициализация БД падает с понятной ошибкой (fail closed) —
«тихого» демо в проде нет.

**Правила SQL** — единые для обоих драйверов:
- Вложенный `db.tx` внутри транзакции — `SAVEPOINT`: ошибку из него можно
  поймать (например, `isUniqueViolation`), и внешняя транзакция продолжит
  работать. Соседние вложенные `db.tx` выполняются по очереди.
- Только tagged template со **значениями** в `${}`. Никаких вложенных
  фрагментов `sql\`...\``, `sql(obj)`, `sql.unsafe` и склейки строк.
- Списки — `= ANY(${ids})` (массив значений).
- jsonb пишем так: `${db.json(value)}` (без `::jsonb` — каст делает драйвер).
  Читаем уже распарсенным объектом.
- Колонки в БД — snake_case, в JS — camelCase (адаптер переводит только ключи
  строк, ключи внутри jsonb остаются как записаны).
- id — `TEXT` (UUID); время — `BIGINT` epoch-мс (в JS `number`); деньги —
  `BIGINT` целые тенге (`amount_kzt`); флаги — `BOOLEAN`.

**Миграции.**
- Файлы `migrations/YYYY-MM-DD-<slug>.sql`, строго идемпотентные
  (`IF NOT EXISTS`), применяются по алфавиту.
- Учёт — таблица `schema_migrations(name, applied_at)` (D-012).
- Раннер: `src/lib/db/migrate.ts` + CLI `npm run db:migrate`.

**Сид.**
- `src/lib/db/seed.ts`, запускается автоматически, если таблица `users`
  пустая и (`isDemo()` или `SEED_DEMO=1`). Также доступен `npm run db:seed`.
- Сид детерминированный: фиксированные id и даты относительно `now()`.
  Демо-данные одинаковы в любом экземпляре.

## 3. Схема v1

```
users(id, email UNIQUE, password_hash, name, role TEXT CHECK(role IN ('admin','author','learner')) DEFAULT 'learner',
      locale TEXT DEFAULT 'ru', email_verified_at BIGINT NULL, created_at)
sessions(id, user_id → users ON DELETE CASCADE, expires_at, created_at)
organizations(id, slug UNIQUE, name, kind TEXT CHECK(kind IN ('owner','client')), created_at)
organization_members(org_id → organizations, user_id → users, role TEXT CHECK(role IN ('manager','member')),
      position TEXT, created_at, PRIMARY KEY(org_id, user_id))
courses(id, slug UNIQUE, title jsonb, summary jsonb, description jsonb, cover TEXT, level TEXT,
      duration_min INT, visibility TEXT CHECK(visibility IN ('public','internal','private')),
      owner_org_id → organizations NULL, status TEXT CHECK(status IN ('draft','published')),
      sequential BOOLEAN DEFAULT false, position INT DEFAULT 0, created_at, updated_at)
course_modules(id, course_id → courses ON DELETE CASCADE, position INT, title jsonb, created_at, UNIQUE(id, course_id))
lessons(id, course_id → courses ON DELETE CASCADE, module_id,
      position INT, slug TEXT, title jsonb, content jsonb, duration_min INT,
      status TEXT CHECK(status IN ('draft','published')), created_at, updated_at, UNIQUE(course_id, slug),
      UNIQUE(id, course_id), (module_id, course_id) → course_modules(id, course_id) ON DELETE/UPDATE CASCADE)
course_offers(id, course_id → courses UNIQUE, price_kzt BIGINT, access_days INT NULL, active BOOLEAN, created_at)
enrollments(id, user_id → users, course_id → courses, source TEXT CHECK(source IN ('purchase','assignment','seat','grant','self')),
      org_id NULL, order_id NULL, granted_by NULL, due_at BIGINT NULL, expires_at BIGINT NULL, revoked_at BIGINT NULL,
      created_at, updated_at, UNIQUE(user_id, course_id))
lesson_progress(user_id, lesson_id → lessons ON DELETE CASCADE, course_id, completed_at, PRIMARY KEY(user_id, lesson_id),
      (lesson_id, course_id) → lessons(id, course_id) ON DELETE/UPDATE CASCADE)
quiz_attempts(id, user_id, lesson_id, block_id TEXT, correct INT, total INT, passed BOOLEAN, created_at)
certificates(id, number UNIQUE, user_id, course_id, holder_name, locale, issued_at, UNIQUE(user_id, course_id))
orders(id, number UNIQUE, user_id NULL, course_id, amount_kzt BIGINT, access_days INT NULL,
      status TEXT CHECK(status IN ('pending','paid','cancelled','refunded')),
      buyer_type TEXT CHECK(buyer_type IN ('person','company')), buyer_name, buyer_email, buyer_phone,
      company_name NULL, company_bin NULL, payment_method TEXT CHECK(payment_method IN ('kaspi','invoice')),
      paid_at NULL, decided_by NULL, created_at, updated_at)
consents(id, user_id NULL, order_id NULL, kind TEXT, version TEXT, created_at)
audit_log(id, actor_id NULL, action TEXT, entity TEXT, entity_id TEXT, meta jsonb, created_at)
```

Целостность: модуль урока — из того же курса, `course_id` прогресса — курс
урока (составные FK).

Заказ (D-020): `user_id` — аккаунт из сессии при оформлении, NULL только если
аккаунт потом удалили (такой заказ оплатить нельзя). `amount_kzt` и
`access_days` (NULL — бессрочно) — снимок предложения курса при оформлении.
Оплата берёт срок из заказа. Миграция `2026-10-19-orders-access-days.sql`
один раз заполняет старые заказы сроком текущего предложения.

`users.email_verified_at` — NULL, пока email не подтверждён
(поток подтверждения — позже; у демо-пользователей сида заполнено).

Индексы: `enrollments(user_id)`, `enrollments(course_id)`, `lessons(module_id, position)`,
`course_modules(course_id, position)`, `orders(status, created_at)`, `audit_log(entity, entity_id)`.

**Локализованные поля** (`title`, `summary`, …) хранятся как `{"ru": "...", "kz": "..."}`.
Чтение — `t(field, locale)`: нужная локаль → `ru` → первая непустая.

**Контент урока**: `content = {"ru": {"v":1,"blocks":[...]}, "kz": {...}}`.

Блоки:

| Тип | Поля |
|---|---|
| `heading` | `level` 2–3, `text` |
| `text` | `markdown`, до 20 000 знаков |
| `video` | `provider`: `youtube` или `placeholder`, `youtubeId?`, `caption?` |
| `callout` | `tone`: `info`, `warn` или `success`, `text` |
| `divider` | — |
| `quiz` | `passScore` 1–100, `questions[]` |

Вопрос теста: `{id, text, options: string[2..8], correct: number[], multiple: boolean, explain?}`.
Схемы блоков — `src/lib/content/blocks.ts`, на zod.

## 4. Доступ — единственный источник правды

`src/lib/access.ts` (пишет фундамент, остальные только используют):

```ts
canAccessCourse(userId, courseId): Promise<{ ok: boolean; enrollment?: Enrollment; reason?: 'none'|'expired'|'revoked' }>
canSelfEnroll(userId, course): Promise<boolean>   // опубликованный public без offer или с price_kzt = 0, или internal своей организации
enroll(input: { userId, courseId, source, orgId?, orderId?, grantedBy?, dueAt?, accessDays?, expiresAt? }, sql?): Promise<Enrollment>  // upsert
revokeEnrollment(userId, courseId, actorId, sql?, opts?: { orderId?, orgId? }): Promise<boolean>  // true — отозвано этим вызовом
```

- **Бесплатный курс** — у него нет offer или `price_kzt = 0`. Offer с ценой > 0
  запрещает `self` независимо от `active` (продажи на паузе не делают курс
  бесплатным).
- **`enroll`:** повтор того же заказа (`orderId` совпадает с `order_id` строки) —
  no-op в любом состоянии: отзыв не снимается, срок не продлевается. Иначе это
  новая выдача: снимает revoked; `source`, `org_id`, `order_id`, `granted_by`,
  `due_at` берутся из input (не переданы — NULL). Срок: у действующего
  зачисления — max(текущий, новый), бессрочный длиннее любого (назначение или
  self не сокращают купленный доступ); у отозванного или истёкшего — новый.
  `accessDays` — целое > 0 или null (бессрочно), иначе `RangeError`.
  `expiresAt` — точный конец срока вместо `accessDays` (в будущем или null).
  Нужен для перехода доступа на другой оплаченный заказ при возврате: срок —
  от оплаты того заказа, без продления.
- **`revokeEnrollment` с фильтром:** `opts.orderId` — отзыв, только если доступ
  держится на этом заказе (возврат заказа A не отзывает доступ по заказу B);
  `opts.orgId` — только если `org_id` совпадает и `source` ∈
  (`assignment`, `self`, `seat`). Без `opts` — отзыв любого источника.
  Условие фильтра — внутри `UPDATE`, без гонки «прочитал — отозвал».
- **Возврат заказа:** `revokeEnrollment(…, { orderId })`. Если доступ снят, а у
  пользователя есть другой оплаченный заказ на курс со сроком, который ещё идёт
  (`paid_at + access_days`), доступ переходит на него: `enroll` с его
  `orderId` и `expiresAt` (в журнале `enrollment.grant` — `expiresAt`, а не
  `accessDays`). Кандидаты на перенос читаются `SELECT … FOR UPDATE` и
  перепроверяются на `status = 'paid'`: одновременные возвраты двух заказов не
  переносят доступ на уже возвращённый.

- Доступ к уроку — только при `ok`. Проверка — на сервере, в каждой странице
  урока и в каждом server action (прогресс, тест, сертификат).
- Платный курс никогда не даёт `self`.
- Неопубликованный урок, модуль или курс слушателю не виден.
- Правильные ответы теста (`correct`, `explain`) никогда не уходят на клиент
  до сдачи. Ответ на попытку (D-020): провал — только `{ passed: false }`, без
  счёта (по счёту ответы подбираются перебором, меняя по одному); сдан —
  `correct`, `total`, `scorePct`, `passScore` и разбор `perQuestion` с
  `explain`. Счёт провала хранится в `quiz_attempts` (отчёт руководителя), но
  слушателю не показывается: «лучший результат» в статусе теста — только по
  сданным попыткам.
- **Документ урока по локали** — одна функция `pickLessonDoc` для страницы,
  теста и «Урок пройден». Казахский документ берётся, только если он непустой
  и содержит все тесты русского (по id блока). Иначе показывается `ru` с
  пометкой. Обязательные для завершения тесты — тесты выбранного документа.
  Админка не сохраняет непустую kz-версию с другим набором тестов
  (`KZ_QUIZ_MISMATCH`) и чинит расхождение в один клик: «Добавить недостающие
  тесты из RU» (копии с теми же id в конец kz) и «Убрать лишние тесты»; другие
  блоки kz не меняются (`src/lib/admin/kzQuizzes.ts`).
- **Адреса уроков:** `RESERVED_LESSON_SLUGS` (`certificate`) заняты страницами
  `/learn/[slug]/…`. Вручную их не задать, авто-адрес получает суффикс
  (`certificate-2`).

## 5. Авторизация

`src/lib/auth/*` (фундамент):

```ts
getCurrentUser(): Promise<User | null>        // React cache
requireUser(locale): Promise<User>            // иначе redirect на /{locale}/login?next=
requireAdmin(locale): Promise<User>
getMemberships(userId): Promise<Membership[]>  // [{orgId, orgName, role}]
isManagerOf(userId, orgId): Promise<boolean>
```

- **Сессия.** Строка в `sessions` (30 дней). Cookie `crp_session` (httpOnly,
  sameSite=lax, secure в проде). Значение —
  `base64url({sid,uid,exp}).hmacSHA256(SESSION_SECRET)`.
- **Проверка.** Подпись и срок, затем строка в `sessions`.
- **Демо-исключение.** Только при `isDemo()` и только для пользователей из сида:
  если строки сессии нет (новый экземпляр без памяти), а подпись верна —
  сессия создаётся заново. В обычном режиме без строки — отказ.
- **Секрет.** `SESSION_SECRET` (32+ символа) обязателен везде, кроме демо на
  PGlite: там без него — фиксированный демо-секрет. Заданный, но короче
  32 символов секрет — ошибка и в демо.
- **Демо-режим** — только явно (`DEMO_MODE=1` или локально без `DATABASE_URL`,
  см. §2). На регистрации в демо — предупреждение не вводить реальные ПДн.
- **Email не подтверждается** (поток — позже, follow-up). Поэтому заказ
  оформляет только вошедший пользователь, и заказ привязывается к аккаунту из
  сессии. Пользователь по email не ищется, при оплате не создаётся (D-020).
  Гостевая покупка — после подтверждения email и ссылки установки пароля (#25).
- **Пароли.** bcryptjs, cost 10; минимум 8 символов.
- **Защита.** Ограничение частоты входа и регистрации — в памяти процесса:
  на IP, на пару IP+email и на email независимо от IP (вход — 20 попыток за
  15 минут на аккаунт). IP клиента — только по доверенной схеме
  (`src/lib/auth/clientIp.ts`, `deriveClientIp`; так же для лимитов заказов и
  проверки сертификатов): `TRUSTED_PROXY_HOPS=N` — N-е значение
  X-Forwarded-For справа; при 0 (по умолчанию) X-Forwarded-For не читается,
  X-Real-IP — только при `TRUST_X_REAL_IP=1`. IP неизвестен — общее ведро
  «на IP», аккаунты защищает лимит на email.
  `?next` принимает только относительные пути (`safeNext`).
- **Лимиты заказов и проверки сертификатов** (D-022). Заказ: сначала лимит на
  аккаунт (10 в час), и только если он пропустил — на известный IP (20 в час);
  при неизвестном IP общего ведра нет. Проверка сертификата: на известный IP
  (30 в минуту), при неизвестном — на номер сертификата (20 в минуту), без
  общего ведра. Остаточный риск: без доверенного прокси (`TRUSTED_PROXY_HOPS`
  или `TRUST_X_REAL_IP`) перебор номеров сертификатов по частоте не ограничен —
  скрипт с разными номерами проходит. Номер — `CRP-<год>-` и 6 знаков из 32
  (~10⁹ на год), страница не индексируется и не показывает email, но при
  тысячах выданных сертификатов долгий перебор находит ФИО и курс. Поэтому на
  проде за прокси настройка доверенного IP обязательна (#24).

**Демо-аккаунты** (пароль `demo12345`), на странице входа — кнопки «Войти как …»
только в демо:

| Email | Роль | Что видит |
|---|---|---|
| `admin@crp.demo` | admin | админка: курсы, заказы, пользователи |
| `manager@crp.demo` | руководитель в организации ЦРП | «Команда»: назначения и отчёт |
| `operator@crp.demo` | сотрудник ЦРП | назначен внутренний курс со сроком, частичный прогресс |
| `client@crp.demo` | предприниматель | купил «Целину», прошёл часть |

## 6. Маршруты

Все страницы — под `src/app/[locale]/`, локали `ru` (по умолчанию) и `kz`.
Мутации — server actions с zod. Route handlers — только для файлов (CSV).

| Путь | Кто | Владелец кода |
|---|---|---|
| `/[locale]` | все | **catalog** — лендинг академии |
| `/[locale]/courses` | все | **catalog** — каталог |
| `/[locale]/courses/[slug]` | все | **catalog** — страница курса. Кнопка зависит от состояния: «Купить» (гостю — «Войти и купить») / «Начать бесплатно» / «Продолжить» |
| `/[locale]/courses/[slug]/buy` | вошедший (гость — на вход с `next`) | **checkout** — форма покупки |
| `/[locale]/orders/[number]` | владелец заказа, держатель ключа из ссылки, admin | **checkout** — статус заказа и инструкция по оплате; владелец (по сессии, не по ключу) может отменить свой неоплаченный заказ |
| `/[locale]/orders/[number]/invoice` | покупатель | **checkout** — счёт на оплату (печатный HTML) |
| `/[locale]/learn` | вошедший | **learn** — «Моё обучение» |
| `/[locale]/learn/[slug]` | зачисленный | **learn** — программа с прогрессом |
| `/[locale]/learn/[slug]/[lesson]` | зачисленный | **learn** — урок: блоки, тест, «Урок пройден», дальше/назад |
| `/[locale]/learn/[slug]/certificate` | зачисленный | **learn** — сертификат (печать в PDF через браузер) |
| `/[locale]/cert/[number]` | все | **learn** — публичная проверка: ФИО, курс, дата |
| `/[locale]/team` | руководитель | **team** — сотрудники, назначения, отчёт |
| `/[locale]/team/report.csv` | руководитель | **team** — CSV (UTF-8 BOM) |
| `/[locale]/admin` | admin | **admin** — сводка |
| `/[locale]/admin/courses`, `/new`, `/[id]`, `/[id]/lessons/[lessonId]` | admin | **admin** — конструктор |
| `/[locale]/admin/orders` | admin | **checkout** — заказы: «Оплачено» / «Отменить» / «Возврат» |
| `/[locale]/admin/users` | admin | **admin** — пользователи, выдать или отозвать доступ |
| `/[locale]/login`, `/register` | гость | **foundation** |

## 7. Дизайн — по редизайну сайта ЦРП (v3)

Эталон:
- `docs/brand/reference/site-redesign.css` — сайт v3 «без декоративного шума»;
- скриншоты `docs/brand/reference/*.webp`;
- правила — `docs/brand/BRAND.md`, включая раздел «Без ИИ-шума» (D-023).

Кратко:
- **Фон и текст.** Фон-«доска» `#f3f4f1`, карточки — плоская белая «бумага»
  с рамкой `--line` и радиусом 20–28 px, текст графит `#14161b`.
- **Красный** `#e31e24` — только акцент. Кнопка-«пилюля» без тени.
- **Тёмные секции** «ночь» `#0e1726`; шапка сайта сплошная `--deep`, как на
  сайте. Кольца и свечение — только в первом экране и финальном блоке главной.
  Страница курса может начинаться с тёмного заголовка без колец и свечения.
- **Шрифты.** Заголовки — Geologica 700 (`font-variation-settings:"SHRP" 100`,
  трекинг −0.03em). Текст — Onest. Рукописного шрифта нет.
- **Без ИИ-шума.** Нет надписей над заголовками, плавающих плашек, размытия,
  иллюстраций-генераций, монограмм, полос цифр, стрелок «→» в ссылках.
- **Вёрстка.** Мобильная первична, контейнер 1200 px, гаттер
  `clamp(16px, 4vw, 40px)`.

Компоненты (фундамент, `src/components/ui/`, целевой состав после D-023):
`Button` (primary / ghost / light / sm / lg / block), `Card`, `Badge`, `Chip`,
`Section` (board / paper / night), `Container`, `PageHeader`, `Breadcrumbs`,
`TextLink`, `Input`, `Select`, `Textarea`, `Field`, `ProgressBar`, `EmptyState`,
`Tabs`, `Table`, `Price`, `Stat` (рабочие счётчики), `Circles` и `Mark`
(декор только для главной).

## 8. Тексты и языки

- next-intl. Сообщения — **по пространствам имён в отдельных файлах**:
  `messages/{ru,kz}/{common,auth,catalog,learn,checkout,team,admin}.json`.
  Загрузчик склеивает их по имени файла.
- Каждый агент владеет только своими файлами.
- Казахские строки пишет тот же агент. Перевод помечен «требует проверки
  носителем» (issue #13).
- Тест паритета ключей ru ↔ kz — в фундаменте.
- `<html lang>`: `ru` или `kk` (D-002).

## 9. Демо-контент (сид)

Курсы — тексты наши, помечены как демо; цены — заглушки до решения ЦРП.

| Курс | Тип | Состав |
|---|---|---|
| «Целина» | public, 99 000 ₸, 365 дней | 8 модулей: Основы бизнеса, Маркетинг, Продажи, Отдел продаж, Управление, Финансовая грамотность, Масштабирование, Личностный рост. В каждом по 2 урока: текст 150–300 слов и тест на 3 вопроса |
| «Удвоение личных продаж» | public, 49 000 ₸ | 3 модуля, 15 видеоуроков (`video` placeholder + конспект), итоговый тест |
| «Как проходит бизнес-разбор» | public, бесплатно | 3 урока + тест |
| «Оператор ЦРП: первые две недели» | internal организации ЦРП | 4 модуля: Компания и продукты, Регламент обзвона, Работа в CRM, Итоговый тест |

Пользователи и данные:
- организации: ЦРП (`owner`);
- демо-аккаунты из §5;
- ещё 5 сотрудников ЦРП с разным прогрессом — для отчёта руководителя;
- заказы: 1 оплаченный (`client@crp.demo` → «Целина»), 2 ожидающих
  (физлицо Kaspi, юрлицо по счёту) — у их покупателей есть аккаунты сида
  (`saule.omarova@example.com`, `b.aliev@example.com`, без демо-кнопки входа);
- 1 выданный сертификат («Как проходит бизнес-разбор» у `client@crp.demo`).

## 10. Тесты и проверки

- **Unit** — `tests/unit/*.test.ts`, node:test + tsx: подсчёт теста,
  схемы блоков, `t()`, `safeNext`, номер сертификата.
- **Интеграционные** — `tests/integration/*.test.ts` на PGlite, без внешней БД;
  в CI — ещё раз на Postgres 16 (`TEST_DATABASE_URL`, каждая тестовая БД — своя
  схема). Гонки параллельных транзакций (`checkout-concurrency`) идут только на
  Postgres: без `TEST_DATABASE_URL` они пропускаются.
  - доступ (все пути §4);
  - идемпотентность `enroll`;
  - заказ → оплачено → зачисление, повтор → без дублей, возврат → отзыв;
  - заказ только вошедшему, без поиска по email; срок — снимок в заказе;
    возврат при другом оплаченном заказе; отмена своего заказа владельцем;
  - гонки (Postgres): параллельные заказы одного пользователя, одновременные
    возвраты;
  - сертификат только после 100 %;
  - изоляция руководителя по организации.
- **E2E** — `tests/e2e/*.spec.ts`, Playwright на `next start` в демо-режиме
  (`DEMO_MODE=1` в `webServer.env`):
  - гость: каталог → курс;
  - вход демо-клиентом → урок → тест → «пройден»;
  - админ: подтверждение заказа;
  - руководитель: назначение.
- **Команды:** `npm run typecheck`, `npm run lint`, `npm run test:unit`,
  `npm run test:integration`, `npm run build`, `npm run test:e2e`.
- **CI** — `.github/workflows/ci.yml` с теми же шагами и сервисом Postgres 16
  для второго прогона интеграционных тестов.

## 11. Деплой превью

Vercel, проект привязан к репозиторию (импорт репозитория в Vercel, переменные
не обязательны). На Vercel без `DATABASE_URL` демо включается само (`VERCEL=1`,
D-016); на своём сервере без `DATABASE_URL` нужен явный `DEMO_MODE=1`, иначе
приложение не стартует (исключение для Vercel — D-019). Без `DATABASE_URL` демо работает на PGlite: данные из сида,
изменения живут до перезапуска экземпляра. В шапке плашка «Демо-версия: данные
сбрасываются», на регистрации — предупреждение не вводить реальные ПДн (данные
вне РК). Для лимитов входа на Vercel — `TRUST_X_REAL_IP=1`.
`serverExternalPackages: ['@electric-sql/pglite']`.

**Снимок схемы демо-базы.** `initdb` в PGlite занимает 5–7 с, на serverless это почти весь
лимит функции. Поэтому `prebuild` (`scripts/prebuild.mjs` → `scripts/build-demo-snapshot.ts`)
в демо-сборке (`DEMO_MODE=1` или `VERCEL=1` без `DATABASE_URL`) прогоняет миграции и кладёт
`pg.dumpDataDir('gzip')` в `.demo/pglite-snapshot.tar.gz` (в git не попадает, в бандл —
через `outputFileTracingIncludes`). Рантайм в демо-проде поднимает PGlite из снимка
(~0,6 с), затем `migrate()` догоняет новые миграции, а сид идёт как раньше, так что даты
демо свежие. Нет файла или он битый — база создаётся с нуля (в dev и тестах снимок не берётся).

Netlify (D-024): `netlify.toml` в корне, переменные сайта `DEMO_MODE=1`, `NODE_VERSION=22`.

Прод — сервер ЦРП в РК с Postgres (`DATABASE_URL`), см. issue #24.

## 12. Кто что строит (зоны агентов)

| Агент | Модель | Папки (владеет) |
|---|---|---|
| foundation | Opus | конфиги, `src/lib/{db,auth,env,access,i18n,content}`, `src/components/{ui,layout}`, `src/app/[locale]/layout.tsx`, `login`, `register`, `messages/*/{common,auth}.json`, `migrations/`, сид, тестовая инфраструктура, CI |
| catalog | Sonnet | `src/app/[locale]/page.tsx`, `src/app/[locale]/courses/page.tsx`, `src/app/[locale]/courses/[slug]/page.tsx`, `src/components/catalog`, `src/lib/catalog`, `messages/*/catalog.json` |
| learn | Sonnet | `src/app/[locale]/learn`, `src/app/[locale]/cert`, `src/components/learn`, `src/lib/learn` (прогресс, тест, сертификаты), `messages/*/learn.json` |
| checkout | Opus | `src/app/[locale]/courses/[slug]/buy`, `src/app/[locale]/orders`, `src/app/[locale]/admin/orders`, `src/lib/orders`, `src/components/checkout`, `messages/*/checkout.json` |
| team | Sonnet | `src/app/[locale]/team`, `src/lib/team`, `src/components/team`, `messages/*/team.json` |
| admin | Sonnet | `src/app/[locale]/admin` (кроме `orders`), `src/lib/admin`, `src/components/admin`, `messages/*/admin.json` |

Чужие папки не меняются. Не хватает чего-то в фундаменте — агент пишет об этом
в отчёте, а не правит сам.
