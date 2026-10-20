# Единый план реализации: почта и аккаунт, загрузка файлов, юрдокументы и PDF сертификата, выкладка

> Проект до реализации. После реализации источник истины — код и docs/lms/BUILD.md; решения — DECISIONS.md.

Автор: architect (T2), 2026-10-19, ветка `claude/amazing-pascal-agse3o`. Документ сводит четыре
проекта в один план. Код и файлы репозитория этим документом не меняются.

Источники (дальше — короткие имена):
- **mail** — `design/mail-account.md` (почтовая очередь, сброс пароля, подтверждение email, напоминания; #4, #25, #9);
- **up** — `design/uploads.md` (загрузка файлов; #8);
- **legal** — `design/legal-certpdf.md` (юрдокументы и согласия #17, PDF сертификата #11);
- **ops** — `design/ops.md` (выкладка на сервер ЦРП, роли БД, health, бэкапы; #24).

Сверено с кодом: `src/lib/{db,env,auth,orders,admin,team,learn,catalog,content,i18n}`, `scripts/*`,
`migrations/*`, `next.config.ts`, `package.json`, `.env.example`, `tests/**`, `.github/workflows/ci.yml`,
`src/components/admin/AuditFeed.tsx`, `messages/*/admin.json`, `DECISIONS.md`,
`docs/lms/BUILD.md`.

**Предусловие (выполнено в волне 0).** Правки полного снимка демо-базы
(`src/lib/db/{index,snapshot}.ts`, `scripts/{build-demo-snapshot.ts,prebuild.mjs}`,
`tests/integration/demo-snapshot.test.ts`, BUILD §11) закоммичены до начала волны 0. План на них
опирается: в снимке есть сид, даты сдвигаются по колонкам `BIGINT *_at`, тест требует, чтобы каждая
BIGINT-колонка кончалась на `_at` или `_kzt`.

---

## 1. Конфликты и как они разрешены

### 1.1 Конфликты между проектами

| # | Конфликт | Решение и почему |
|---|---|---|
| К-1 | **Номера решений.** up предлагает D-024 (занят: Netlify), legal — D-025/D-026, mail — D-0MA…D-0MD, ops — D-0XX-ops-1…4 | Новая нумерация D-025…D-036 (§3). Номера в комментариях миграций и в тексте модулей — по ней |
| К-2 | **Проверка «функция включена».** mail — `mailFeature()` в `mail/config.ts`, legal — `isLegalEnabled()`, up и PDF — сырой `isFeatureEnabled()`, у PDF 503 без адреса сайта | Одна функция `isFeatureActive(name)` в `src/lib/features.ts`: выключатель и условия готовности (§2.1). `mailFeature` и `isLegalEnabled` не создаются. Иначе условия «в проде только если…» разойдутся по модулям |
| К-3 | **`registerAction`** (`src/lib/auth/actions.ts`) правят mail (письмо подтверждения в транзакции) и legal (токен версий, согласия с хэшем); **`register/*`** — legal | Одна задача 3A делает обе правки. Последовательный rebase двух PR (как предлагал legal) даёт конфликт в одной функции и двойную правку тестов `core-auth-actions` |
| К-4 | **Заказ** (`src/lib/orders/{types,validation,create,actions}.ts`, `CheckoutForm.tsx`, `buy/page.tsx`, `tests/e2e/checkout.spec.ts`) правят mail (`email_unverified`, плашка) и legal (две галочки, токен, `insertConsents`) | Та же задача 3A. Это зона денег: один исполнитель, ревью Opus. E2E покупки ломается от обеих функций, чинить его дважды нельзя |
| К-5 | **Карточка пользователя в админке** (`admin/users/[id]/page.tsx`): mail — кнопка «ссылка для смены пароля», legal — блок «Согласия» | Одна задача 4A |
| К-6 | **`messages/*/admin.json`** пополняют mail (`shell.nav.mail`, `mail.*`, `users.sendReset*`) и up (`lessonEditor.*`, `errors.*`) | Все ключи `admin.json` добавляет волна 0 по готовым таблицам из mail §4 и up §4, плюс подписи новых действий журнала (§2.6). Задачи волн 1+ `admin.json` не трогают |
| К-7 | **Помощник e2e `openLatestMailLink`** нужен e2e сброса пароля и e2e покупки, а страница «Письма» в mail стоит в шаге 2B | Страницы «Письма» (список и письмо) переходят в задачу 1A. Кнопка «Сформировать напоминания» остаётся в 4A |
| К-8 | **Обложка `visibleCover()`** в up — правка чужих зон (`catalog/queries.ts`, `learn/data.ts`) в шаге 2B | Делает волна 0: функция чистая, правка в две строки, ни одна задача волн 1+ эти файлы не трогает |
| К-9 | **`src/components/learn/*`**: legal B4 берёт всю папку, up 2B правит `Blocks`, `Markdown`, новые `ImageBlock`, `FileBlock` | Задача PDF (2B) создаёт только новый `CertificatePdfLink.tsx` и правит страницы сертификата и «Моё обучение». Остальное в `components/learn` — задача 4B |
| К-10 | **Крон.** mail — `CRON_TZ=Asia/Almaty` и `cd <app> && node --env-file …`; ops — UTC без `CRON_TZ`, запуск через `run-script.sh` | Как в ops (§3.10): Ubuntu cron `CRON_TZ` надёжно не поддерживает. Напоминания — `0 4-14 * * *` UTC, то есть 09:00–19:00 по Астане. Скрипты сами считают время по Астане (`isoWeekKey`) |
| К-11 | **`files-sweep` при выключенном `UPLOADS`.** ops — выходит с кодом 0, up — работает всегда (только удаляет) | Как в up: подметание идёт всегда. Если флаг выключили после загрузок, мусор всё равно надо убрать, а удаление защищено проверкой ссылок. Без хранилища (`storageConfig().ok === false`) — сообщение и код 0 |
| К-12 | **Вход в БД из скриптов.** mail и up — `openDriver → setDb → migrate`; ops — от роли `crp_app` DDL нельзя, скрипты зовут `prepareDb()` | Как в ops. `migrate()` вызывают только `scripts/{db-migrate,db-seed,build-demo-snapshot}.ts` и `src/lib/db/testing.ts`. Это проверяет unit-тест (§5, волна 0) |
| К-13 | **Имена npm-скриптов.** mail — `mail:send`, `reminders:run`; файлы — `mail-worker.ts`, `send-reminders.ts` | Имя скрипта = имя файла: `mail:worker`, `reminders:send`, `files:sweep`. Крон ops вызывает файлы по имени, не npm |
| К-14 | **Журнал.** up — `course.cover.set` (три сегмента); mail — `admin.password_reset_sent` (сущность — не первая часть); ops — своя вставка, потому что `writeAudit` требует `actorId: string`; mail и up пишут `actor_id NULL` | Общий `writeAudit` в `src/lib/audit.ts` с `actorId: string \| null`. Имена — строго `<сущность>.<глагол>`: `AuditFeed` ищет подпись по вложенному ключу `audit.actions.<сущность>.<глагол>`, а три сегмента ломают дерево ключей. Полный список — §2.6 |
| К-15 | **`siteUrl()`** вне демо без `NEXT_PUBLIC_SITE_URL` возвращает `http://localhost:3000`. mail закрывает это в `mailFeature`, legal — в `publicSiteUrl()` (503), ops — правилом preflight `site_url_not_https` | Общая `siteUrlConfigured(env)` в `env.ts`: вне демо — заданный адрес с `https://`. Входит в условия готовности почты и PDF (§2.1). Маршрут PDF дополнительно отвечает 503 (вторая линия) |
| К-16 | **Переменные окружения.** У каждого проекта свой кусок `.env.example`, ops требует тест «ключи `deploy/env/app.env.example` ⊆ `.env.example`» | `.env.example` целиком пишет волна 0 (§4.2) и держит надмножество. `SMTP_*` нигде не добавляется до задачи SMTP-адаптера |
| К-17 | **Зависимости и конфиг.** `@react-pdf/renderer`, npm-скрипты, `next.config.ts` (трассировка `content/legal`, шрифтов, логотипа) | Только волна 0, отдельными коммитами. Версия проверена: `npm view` → 4.9.0, peer `react ^19`; пакет есть во встроенном списке `serverExternalPackages` Next 16 |
| К-18 | **Трассировка файлов для PDF.** legal — отдельный ключ маршрута `'/[locale]/learn/[slug]/certificate/pdf'` | Всё в существующий ключ `'/**'`: `./content/legal/**`, `./assets/fonts/pdf/**`, `./docs/brand/logo/crp-logo.png`. Около 300 КБ на функцию — меньше риска промахнуться шаблоном маршрута в Netlify/Vercel |
| К-19 | **Текст ошибок согласий в заказе.** legal кладёт `offerRequired`/`pdRequired` в `legal.json`, а форма заказа берёт ошибки поля из `checkout.form.errors.<поле>.<код>` | Ключи `checkout.form.errors.consentOffer.required` и `checkout.form.errors.consentPd.required` в `checkout.json` (тексты — из legal §4.2). В `legal.json` этих ключей нет |
| К-20 | **Порядок миграций.** mail — `2026-10-19-mail-tokens.sql` (сортируется между `init` и `orders-access-days`), up и legal — `2026-10-20-*` | Все три — `2026-10-20-*`, после существующих (§2.7). Задача требует, чтобы новые имена шли после уже накатанных: иначе `db:status` на проде показывает «pending в середине» |
| К-21 | **Подписание `isLegalEnabled` и kz.** legal В-1 рекомендует на проде включать `LEGAL` только при утверждённых ru и kz | Входит в условие готовности `LEGAL` (§2.1): вне демо нужны `draft: false` и непустой `sha256.kz` у всех четырёх документов. Запасной ru — только в демо. Владелец может ослабить (вопрос 3) |
| К-22 | **Плашка подтверждения в демо-покупке.** С `EMAIL_VERIFY` новый демо-покупатель не оформит заказ, пока не откроет письмо, а в демо писем нет | В демо плашка на форме покупки говорит, где взять ссылку: новый ключ `auth.verifyNotice.demoHint` — «Демо-версия: письмо можно открыть в админке, раздел „Письма“, войдя как администратор». Демо-клиент из сида уже подтверждён, его путь покупки не меняется |

### 1.2 Конфликты с кодом

| # | Расхождение | Решение |
|---|---|---|
| КК-1 | Тест снимка (`demo-snapshot.test.ts`): все BIGINT-колонки — `*_at` или `*_kzt`. В mail есть `mail_outbox.locked_until BIGINT`, в up — `files.size_bytes BIGINT` | `locked_until` → `lease_until_at` (это время, его надо сдвигать вместе с остальными). `size_bytes` → `INTEGER`: файл ≤ 25 МБ, предел INTEGER — 2 ГБ. Сумма для квоты в Postgres всё равно BIGINT, драйвер отдаёт number |
| КК-2 | `init()` в незакоммиченной правке сдвигает время снимка до `migrate()`. ops заменяет тело `init()` на `prepareDb()` | `init()` = `openDriver()` → `refreshSnapshotTime()` (только демо-снимок) → `prepareDb(db)`. Сдвиг времени в `prepareDb` не входит: скрипты снимком не пользуются |
| КК-3 | `writeAudit` в `src/lib/admin/audit.ts` (зона admin) требует `actorId: string` | Новый `src/lib/audit.ts` (фундамент, §2.6). `admin/audit.ts` сохраняет прежнюю сигнатуру и делегирует ему |
| КК-4 | `isDemo()` без параметра, а матрицы флагов, автомиграций и preflight тестируют произвольное окружение | `isDemo(env = process.env)`; прежние вызовы без аргумента работают как раньше |
| КК-5 | `AuditFeed` показывает «Действие: {action}», если нет подписи `audit.actions.<сущность>.<глагол>` | Волна 0 добавляет подписи ru/kz для всех новых действий (§2.6) |
| КК-6 | BUILD §6: «Route handlers — только для файлов (CSV)». Новые: `/api/uploads`, `/api/files/[id]`, `…/certificate/pdf`, `/api/health` | Формулировка §6 меняется (§4.1) и фиксируется в D-028 |
| КК-7 | BUILD §5 и D-020: «Email не подтверждается… гостевая покупка — после подтверждения email и ссылки установки пароля (#25)» | D-032 уточняет D-020: ссылки установки пароля нет, гость регистрируется и подтверждает email. BUILD §5 переписывается (§4.1) |
| КК-8 | BUILD §8: список namespace без `files`, `legal`; `mail.json` в mail не входит в `NAMESPACES` | `NAMESPACES` += `files`, `legal`. `mail.json` грузит `src/lib/mail/i18n.ts` напрямую (письма, не интерфейс). Тест паритета берёт все файлы папки сам |
| КК-9 | mail ссылается на тип `L10nRaw`, а в `src/lib/content/types.ts` он называется `L10n` | В контрактах — `L10n` |
| КК-10 | В коде два `getCourse`: `src/lib/admin/courses.ts` (админ) и `src/lib/learn/data.ts` (слушатель). legal `data.ts` пишет `getCourse({ slug })` | Для PDF — `getCourse` из `src/lib/learn/data.ts` (только опубликованный курс) |
| КК-11 | `core-session.test.ts` сравнивает объект пользователя целиком | Волна 0 добавляет `emailVerified` в `User`/`SessionUserRow` и правит этот тест |
| КК-12 | ops: `organization_members` заполняет только сид, экрана управления нет. На чистом проде «Команда» и напоминания (mail §3.7) пустые | Не входит в план. Отдельный issue в зону admin (§7) и вопрос владельцу 12 |
| КК-13 | ops-nginx ставит CSP на все ответы, маршрут файлов ставит свой CSP с `sandbox` — будет два заголовка | Оставляем: браузер применяет оба, итог строже. Задача 5B не убирает CSP у `/api/files/` |

---

## 2. Единые контракты

Ими пользуются все исполнители. Отступить можно только через architect.

### 2.1 Флаги — `src/lib/features.ts` (волна 0, D-025)

```ts
// Флаги функций (D-025). Только сервер: значение передаётся в клиентские компоненты пропсом.
export const FEATURES = ['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS', 'UPLOADS', 'LEGAL', 'CERT_PDF'] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Env = Record<string, string | undefined>;   // совместим с NodeJS.ProcessEnv

/** Выключатель: FEATURE_<NAME> '1' — вкл, '0' — выкл, не задан или пуст — isDemo(env).
 *  Другое значение — выкл (fail closed) и одно предупреждение в лог на процесс. */
export function isFeatureEnabled(name: FeatureName, env?: Env): boolean;

export type FeatureBlocker = 'flag_off' | 'mail_outbox' | 'site_url' | 'legal_not_approved';
/** Что мешает функции работать. В демо — только 'flag_off'. Для preflight и тестов. */
export function featureBlockers(name: FeatureName, env?: Env, opts?: { today?: string }): FeatureBlocker[];

/** Работает ли функция: выключатель и условия готовности. ЕДИНСТВЕННАЯ проверка для страниц,
 *  server actions, маршрутов, скриптов и меню. */
export function isFeatureActive(name: FeatureName, env?: Env, opts?: { today?: string }): boolean; // = blockers.length === 0
```

Условия готовности. В демо (`isDemo(env)`) их нет: работает выключатель.

| Флаг | Вне демо функция активна, только если | Откуда проверка |
|---|---|---|
| `PASSWORD_RESET`, `EMAIL_VERIFY`, `REMINDERS` | `mailTransportName(env) !== 'outbox'` и `siteUrlConfigured(env)` | `src/lib/mail/config.ts`, `src/lib/env.ts` |
| `UPLOADS` | — (нет хранилища → загрузка 503 `storage_unavailable`, админ видит ошибку; up §6) | — |
| `LEGAL` | `legalPublishable(today)`: у `offer`, `privacy`, `pd_consent`, `refund` есть действующая версия с `draft: false` и `sha256.kz !== null` | `src/lib/legal/registry.ts` (чистые данные, без fs) |
| `CERT_PDF` | `siteUrlConfigured(env)` | `src/lib/env.ts` |

`MAIL_TRANSPORT` сейчас принимает только `outbox`, поэтому почтовые функции на проде не
заработают, пока не будет SMTP-адаптера (§7). Это намеренно (D-030).

`src/lib/env.ts` (волна 0):
```ts
export function isDemo(env?: Env): boolean;                 // логика прежняя, окружение — параметром
/** В демо true, если явного адреса нет или он корректный http(s); вне демо — только явный https.
 *  Источники адреса — как в siteUrl(): NEXT_PUBLIC_SITE_URL → URL (только демо) →
 *  VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL → localhost. */
export function siteUrlConfigured(env?: Env): boolean;
```

Правила для исполнителей:
- в коде функций — только `isFeatureActive`; `isFeatureEnabled` — только preflight, админские
  пометки режима и тесты;
- клиентский компонент получает boolean пропсом и `process.env.FEATURE_*` не читает;
- матрицы тестов передают `env` аргументом. Интеграционные тесты, которым нужно конкретное
  состояние, ставят `process.env.FEATURE_X` и возвращают прежнее значение в `after`;
- в интеграционных тестах (`isDemo()` = true) и в e2e (`DEMO_MODE=1`) все флаги по умолчанию
  включены. Поведение при выключенном флаге проверяют интеграционные тесты.

### 2.2 Почта — `src/lib/mail/` (типы и конфиг — волна 0; остальное — 1A, 4A)

Отличия от mail §3.4: `mailFeature` нет (заменён на `isFeatureActive`); `L10nRaw` → `L10n`; поле аренды —
`leaseUntilAt`.

```ts
// types.ts (волна 0)
export const MAIL_TEMPLATES = ['password_reset', 'password_changed', 'email_verify',
  'assignment_new', 'due_soon', 'overdue', 'manager_digest'] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];
export type MailCategory = 'auth' | 'notice';
export const MAIL_CATEGORY: Record<MailTemplate, MailCategory>;   // первые три — 'auth'
export type MailStatus = 'held' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
export type DigestItem = { name: string; courseTitle: L10n; dueAt: number };
export type MailParams = { /* как в mail §3.4, L10n вместо L10nRaw */ };
export type EnqueueInput<T extends MailTemplate = MailTemplate> = {
  template: T; locale: Locale; to: string; userId: string | null; params: MailParams[T];
  secret?: { raw: string; expiresAt: number };   // только password_reset и email_verify
  dedupeKey?: string; nowMs?: number;
};
export type EnqueueResult =
  | { queued: true; id: string; status: 'held' | 'queued' }
  | { queued: false; reason: 'duplicate' | 'recipient_cap' | 'global_cap' };
export type RenderedMail = { subject: string; text: string; html: string };

// config.ts (волна 0; 1A может дополнять)
export type MailTransportName = 'outbox' | 'smtp';
/** Демо → всегда 'outbox'. Иначе MAIL_TRANSPORT; сейчас принимается только 'outbox',
 *  другое значение — предупреждение и 'outbox' (до задачи SMTP-адаптера). */
export function mailTransportName(env?: Env): MailTransportName;
export function mailFrom(env?: Env): string | null;
export function mailReplyTo(env?: Env): string | null;
export const MAIL_AUTH_RECIPIENT_HOURLY = 5;
export function mailAuthHourlyCap(env?: Env): number;      // MAIL_AUTH_HOURLY_CAP, по умолчанию 300
export function mailRetentionDays(env?: Env): number;      // MAIL_RETENTION_DAYS, по умолчанию 90, не меньше 31

// outbox.ts (1A)
/** Вставка в транзакции вызывающего. Статус: транспорт outbox → 'held', иначе 'queued'.
 *  Для 'auth' — лимит получателя (5/ч) и общий предохранитель (mailAuthHourlyCap()/ч) по mail_outbox.
 *  dedupeKey → INSERT … ON CONFLICT (dedupe_key) DO NOTHING RETURNING id → 'duplicate'. */
export async function enqueueMail<T extends MailTemplate>(sql: Sql, input: EnqueueInput<T>): Promise<EnqueueResult>;
/** Снять с отправки письма с секретами пользователя данного шаблона: secret = NULL, held|queued → cancelled. */
export async function cancelSecrets(sql: Sql, input: { userId: string; template: 'password_reset' | 'email_verify'; nowMs?: number }): Promise<number>;

// render.ts, links.ts, transport.ts (1A) — как в mail §3.4
export function renderMail(row: MailRow): RenderedMail;
export interface MailTransport { readonly name: 'smtp'; send(m: { id: string; from: string; replyTo?: string; to: string;
  subject: string; text: string; html: string }): Promise<{ providerId?: string }>; }
export async function resolveTransport(): Promise<MailTransport | null>;   // null — outbox

// worker.ts (4A) — как в mail §3.5; захват: … SET status='sending', attempts = attempts + 1,
//   lease_until_at = ${t + 300_000} … OR (status = 'sending' AND lease_until_at < ${t})
export const RETRY_DELAYS_MS: readonly number[];   // [1 мин, 5 мин, 30 мин, 2 ч], всего 5 попыток
export async function deliverPending(opts: { transport: MailTransport; nowMs?: number; batch?: number }):
  Promise<{ sent: number; retried: number; failed: number; cancelled: number }>;
export async function purgeMail(nowMs?: number): Promise<{ letters: number; tokens: number; secrets: number }>;
```

Правила для всех, кто ставит письма:
- `enqueueMail` — только внутри транзакции действия, которое письмо вызывает (регистрация,
  сброс, назначение). Отдельной транзакции «потом отправить» нет;
- в `params` — без секретов и ссылок. Ссылки собирает только `links.ts` из `siteUrl()`;
- результат `enqueueMail` пользователю не раскрывается в сценариях, где это даёт перечисление
  (сброс пароля);
- письмо «доступ открыт» и счёт — будущие шаблоны (follow-up зоны checkout). Новый шаблон =
  ключ в `MAIL_TEMPLATES`, тип в `MailParams`, тексты в `mail.json`, ссылка в `links.ts`.

Токены — `src/lib/auth/tokens.ts` (1A), как в mail §3.2 без изменений:
`generateToken`, `hashToken`, `isTokenShape`, `issueToken(sql, …)` (гасит прежние токены и вызывает
`cancelSecrets`), `consumeToken(sql, raw, kind, nowMs?)`, `TOKEN_TTL_MS`.

Сброс и подтверждение — `src/lib/auth/recovery.ts` (2A), как в mail §3.3. Для задачи 3A важна
сигнатура:
```ts
export async function sendVerification(sql: Sql, input: { userId: string; email: string; name: string;
  locale: Locale; next?: string | null; nowMs?: number }): Promise<EnqueueResult>;  // вызывать в транзакции регистрации
```

### 2.3 Согласия — `src/lib/legal/` (типы и реестр — волна 0; остальное — 1B)

```ts
// types.ts (волна 0) — как legal §3.1, плюс:
export const CHECKOUT_CONSENTS = ['offer', 'pd_processing'] as const;
export const REGISTER_CONSENTS = ['pd_processing'] as const;
export const LEGACY_CONSENT_VERSION = '2026-10-19';   // заменяет PD_CONSENT_VERSION, CONSENT_VERSION и копию в сиде (3A)

// registry.ts (волна 0: функции и пустой LEGAL_VERSIONS; 1B добавляет версии и хэши)
export const LEGAL_VERSIONS: readonly LegalVersion[];
export function currentVersion(kind: LegalDocKind, opts: { allowDrafts: boolean; today?: string }): LegalVersion | null;
export function findVersion(kind: LegalDocKind, version: string): LegalVersion | null;
export function versionsOf(kind: LegalDocKind): readonly LegalVersion[];
export function versionsToken(kinds: readonly ConsentKind[], opts: { allowDrafts: boolean }): string;
/** Все четыре документа можно публиковать в проде: действующая версия draft:false и kz-текст есть. */
export function legalPublishable(today?: string): boolean;

// consents.ts (1B) — вызывает 3A
export async function prepareConsents(kinds: readonly ConsentKind[], locale: Locale): Promise<PreparedConsent[]>; // до транзакции
export function consentTokenFresh(token: unknown, kinds: readonly ConsentKind[]): boolean;  // LEGAL неактивен → true
export async function insertConsents(sql: Sql, input: { userId: string; orderId: string | null;
  context: 'register' | 'checkout'; at: number; consents: PreparedConsent[] }): Promise<void>;
export async function listUserConsents(userId: string): Promise<ConsentView[]>;            // 4A, после requireAdmin
```
`flags.ts` из legal §3.1 не создаётся: `isLegalEnabled()` = `isFeatureActive('LEGAL')`,
`legalAllowDrafts()` = `isDemo()` — внутри `src/lib/legal/consents.ts` и страниц.

### 2.4 Файлы — контракт сервер ↔ интерфейс (волна 0; реализация — 3B, интерфейс — 4B)

Волна 0 создаёт целиком, по up §3.2–3.3:
- `src/lib/storage/limits.ts` — `FILE_TYPES`, `FileExt`, `FileKind`, `UPLOAD_LIMITS`, `PURPOSE_TYPES`;
- `src/lib/files/types.ts` — `UploadPurpose`, `FileRow` (`sizeBytes: number`), `StoredFile`,
  `UploadErrorCode`, `UploadError`;
- `src/lib/files/url.ts` — без импортов: модуль попадает и в клиентский бандл (4B):
```ts
export function fileUrl(id: string): string;                 // '/api/files/<id>'
export const FILE_URL_RE: RegExp;                            // up §3.7
export function isUuid(s: string): boolean;
/** Обложка для витрины и обучения: при неактивном UPLOADS адрес /api/files/… заменяется на null.
 *  Флаг передаёт сервер: visibleCover(r.cover, isFeatureActive('UPLOADS')). */
export function visibleCover(cover: string | null, uploadsActive: boolean): string | null;
```

HTTP-контракт для `UploadButton` (4B) и маршрутов (3B), по up §3.6:
- `POST /api/uploads?purpose=lesson_material|course_cover&courseId=<uuid>[&lessonId=<uuid>]`,
  тело — сырые байты (`application/octet-stream`), заголовок `X-Upload-Name: encodeURIComponent(name)`;
- ответ `201 { ok: true, file: StoredFile }` | `{ ok: false, error: UploadErrorCode, params? }`;
- server actions `setCourseCoverAction(locale, courseId, fileId)`, `clearCourseCoverAction(locale, courseId)`,
  `deleteFileAction(locale, fileId)` в `src/lib/files/actions.ts` (3B) → `ActionResult`.

### 2.5 Слой БД для приложения и скриптов (волна 0; D-026)

```ts
// src/lib/db/migrate.ts — как ops §3.13
export type MigrationStatus = { files: string[]; applied: string[]; pending: string[]; unknown: string[] };
export function diffMigrations(files: string[], applied: string[]): MigrationStatus;
export async function migrationStatus(db: Pick<Db, 'sql'>, dir?: string): Promise<MigrationStatus>; // только SELECT
export class MigrationsPendingError extends Error { readonly pending: string[] }
export async function assertMigrated(db: Pick<Db, 'sql'>, dir?: string): Promise<void>;
// migrate(): сначала migrationStatus() (только SELECT); нечего накатывать → [] без DDL и блокировки.
// Пустой каталог миграций — ошибка. MIGRATIONS_DIR учитывается только вне production.
export async function migrate(db: DbHandle, dir?: string, opts?: { lockTimeoutMs?: number }): Promise<string[]>;
// src/lib/db/locks.ts — все ключи advisory-блокировок (MIGRATION_LOCK_KEY, UPLOAD_QUOTA_LOCK_KEY…), тест уникальности.

// src/lib/db/index.ts
/** DB_MIGRATE_ON_START=1 → да; '0' → нет; иначе да, если isDemo(env) или NODE_ENV — development/test.
 *  Крон и CLI без NODE_ENV с DATABASE_URL миграции не накатывают (D-026). */
export function autoMigrateEnabled(env?: Env): boolean;
/** migrate (autoMigrate) или assertMigrated, затем сид, если нужен (seed по умолчанию — seedPermitted(env):
 *  isDemo() || (SEED_DEMO=1 && NODE_ENV≠production); D-040, ops §3.13). */
export async function prepareDb(db: DbHandle, opts?: { autoMigrate?: boolean; seed?: boolean }): Promise<void>;
// init(): openDriver() → refreshSnapshotTime() (только демо-снимок) → prepareDb(db)
```

Шаблон любого скрипта крона или CLI (`mail-worker`, `send-reminders`, `files-sweep`, `create-admin`)
— общий вход `openScriptDb()` из `src/lib/db/` (волна 0):
```ts
const close = await openScriptDb();   // openDriver → отказ для PGlite в памяти → prepareDb({ seed: false }) → setDb
try {
  /* работа; флаг — isFeatureActive(...): выключено → сообщение и код 0 */
} finally {
  await close();
}
```
Исключение — `ops-preflight --db`: он открывает голый драйвер `openDriver()` без `prepareDb`,
потому что выкладка запускает его до `db:migrate` (ops §3.5, шаг 5), и `assertMigrated` ронял бы
его `MigrationsPendingError` на каждой новой миграции. Его проверки только читают (ops §3.15).
`npm run db:status` (`db-migrate.ts --status`) — только чтение, коды выхода по ops §3.13: 0 — всё
накатано, 3 — есть ненакатанные, 1 — ошибка (в том числе БД в памяти и неверный аргумент). Расширение закрытых списков CHECK — D-037 и BUILD §2.
Лог скриптов — только счётчики и id, без email, имён и текстов.

### 2.6 Журнал действий — `src/lib/audit.ts` (волна 0)

```ts
export type AuditEntity = 'user' | 'course' | 'module' | 'lesson' | 'enrollment' | 'order' | 'certificate'
  | 'team' | 'org' | 'file' | 'mail' | 'reminders' | 'system';
/** Реестр имён: существующие действия (course.create … team.assign) + новые из таблицы ниже. */
export const AUDIT_ACTIONS = [ /* … */ ] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
/** Вставка в транзакции вызывающего. actorId NULL — система, крон, CLI. В meta — id, коды, счётчики;
 *  без email, ФИО, телефонов, токенов. */
export async function writeAudit(sql: Sql, e: { actorId: string | null; action: AuditAction;
  entity: AuditEntity; entityId: string; meta?: Record<string, unknown> }): Promise<void>;
```
`src/lib/admin/audit.ts` сохраняет сигнатуру `writeAudit(sql, actorId, action, entity, entityId, meta)`
и вызывает новую функцию. Имя действия — два сегмента: `<сущность>.<глагол_snake>`.

Новые действия. Подписи в `admin.json` → `audit.actions.<сущность>.<глагол>` добавляет волна 0;
kz — с пометкой «требует проверки носителем» (#13).

| Действие | entity / entityId | actor | Задача | ru | kz |
|---|---|---|---|---|---|
| `user.password_reset_request` | user / id | NULL | 2A | Запрошена смена пароля: {user} | Құпиясөзді ауыстыру сұралды: {user} |
| `user.password_reset` | user / id | сам | 2A | Пароль изменён по ссылке: {user} | Құпиясөз сілтеме арқылы өзгертілді: {user} |
| `user.password_reset_link` | user / id | админ | 4A | Отправлена ссылка для смены пароля: {user} | Құпиясөзді ауыстыру сілтемесі жіберілді: {user} |
| `user.email_verify_request` | user / id | сам | 2A | Отправлено письмо для подтверждения email: {user} | Email-ды растау хаты жіберілді: {user} |
| `user.email_verify` | user / id | сам | 2A | Email подтверждён: {user} | Email расталды: {user} |
| `user.create_admin` | user / id | NULL (CLI) | 5A | Создан администратор: {user} | Әкімші құрылды: {user} |
| `user.role_change` (есть) | user / id | NULL (CLI `--promote`), meta `{to:'admin', via:'cli', sessionsRevoked}`; с `--identity-confirmed` ещё `{identity:'offline', passwordReset:true, emailVerified}` (D-039, 5A-хвосты) | 5A | — | — |
| `org.create` | org / id | NULL (CLI) | 5A | Создана организация | Ұйым құрылды |
| `org.member_add` | org / id, meta `{userId, role}` | NULL (CLI) | 5A | В организацию добавлен сотрудник | Ұйымға қызметкер қосылды |
| `mail.fail` | mail / mailId, meta `{template}` | NULL | 4A | Письмо не отправлено после 5 попыток | Хат 5 әрекеттен кейін жіберілмеді |
| `reminders.run` | reminders / `'reminders'`, meta `{dueSoon, overdue, digests}`; крон — только если поставлено хотя бы одно письмо, ручной запуск — всегда | админ или NULL | 4A | Сформированы напоминания о сроках | Мерзімдер туралы еске салғыштар құрылды |
| `file.upload` | file / id, meta `{courseId, lessonId, purpose, ext, sizeBytes}` (без имени файла: оно может быть ПДн, а журнал не чистится) | админ | 3B | Загружен файл в курс «{course}» | «{course}» курсына файл жүктелді |
| `file.delete` | file / id | админ | 3B | Удалён файл из курса «{course}» | «{course}» курсынан файл өшірілді |
| `file.purge` | file / id, meta `{reason:'orphan'}` | NULL | 3B | Удалён неиспользуемый файл | Қолданылмайтын файл өшірілді |
| `course.cover_set` | course / id, meta `{fileId}` | админ | 3B | Обновлена обложка курса «{course}» | «{course}» курсының мұқабасы жаңартылды |
| `course.cover_clear` | course / id, meta `{fileId}` | админ | 3B | Убрана обложка курса «{course}» | «{course}» курсының мұқабасы алынды |
| `lesson.update` (есть) | + meta `files` | админ | 3B | — | — |

Для `file.*` подстановка `{course}` работает, если `src/lib/admin/stats.ts` умеет брать курс из
`meta.courseId`. Если не умеет — подпись без `{course}`; это решает исполнитель волны 0 по коду
`stats.ts`, без правки логики ленты. Согласия (legal) и скачивания файлов и PDF в журнал не пишутся.

### 2.7 Миграции — порядок и имена (все — волна 0)

Применяются по алфавиту после `2026-10-19-init.sql` и `2026-10-19-orders-access-days.sql`:

1. `migrations/2026-10-20-legal-consents.sql` — legal §2.1 без изменений, в шапке ссылка на D-035.
2. `migrations/2026-10-20-mail-outbox.sql` — mail §2 с правками:
   - `locked_until BIGINT` → `lease_until_at BIGINT` (комментарий: «аренда воркера: истекла — письмо берётся снова»);
   - шапка ссылается на D-030, D-031.
3. `migrations/2026-10-20-uploads.sql` — up §2 с правками:
   - `size_bytes BIGINT NOT NULL CHECK (size_bytes > 0)` → `size_bytes INTEGER NOT NULL CHECK (size_bytes > 0)`;
   - шапка ссылается на D-034.

Таблицы трёх файлов друг от друга не зависят. Двойной прогон (`core-migrations`) и правило
`*_at`/`*_kzt` (`demo-snapshot`) обязаны проходить. Имена закреплены: если волна 0 выполняется
позже 20.10, файлы называются так же.

### 2.8 Сообщения — namespace и владельцы ключей

| Файл (`ru` и `kz`) | Что добавляется | Кто | Источник |
|---|---|---|---|
| `admin.json` | `shell.nav.mail`; `mail.*`; `users.sendReset`, `users.sendResetDone`; `lessonEditor.blocks.types.{image,file}`; `lessonEditor.issue.{fileNotFound,fileWrongKind}`; `errors.{FEATURE_DISABLED,FILE_IN_USE,FILE_NOT_FOUND}`; `audit.actions.*` (§2.6) | волна 0 | mail §4 (таблица admin.json), up §4 (список admin.json), §2.6 |
| `files.json` (новый, в `NAMESPACES`) | волна 0 — `{}`; все ключи — 4B | 4B | up §4 |
| `legal.json` (новый, в `NAMESPACES`) | волна 0 — `{}`; ключи — 1B, без `consent.offerRequired`/`consent.pdRequired` | 1B | legal §4.2–4.3 |
| `mail.json` (новый, **не** в `NAMESPACES`) | волна 0 — `{}`; ключи — 1A | 1A | mail §4 |
| `auth.json` | `login.forgot`, `forgot.*`, `reset.*`, `verify.*`, `verifyNotice.*` + `verifyNotice.demoHint` (К-22), `errors.invalid_token`, `errors.unavailable` | 2A | mail §4 |
| `checkout.json` | `errors.email_unverified`; `form.errors.consentOffer.required`, `form.errors.consentPd.required` (К-19) | 3A | mail §4, legal §4.2 |
| `learn.json` | `certificate.pdfHint`, `certificate.pdfTooMany`, `certificate.sheet.metaTitle`, `index.certificatePdf` | 2B | legal §4.4 |
| `common.json`, `catalog.json`, `team.json` | без изменений | — | — |

Удаления ключей в плане нет: старые подписи согласий (`auth.register.consent`,
`checkout.form.errors.consent.*`) нужны при выключенном `LEGAL`. Порядок коммитов в каждой задаче:
1) добавление текстов (`messages/*`), 2) код, 3) удаление ключей, если оно когда-нибудь понадобится.

### 2.9 npm-скрипты и зависимости (волна 0, отдельный коммит)

После волны 2 добавлен прямой пин `fontkit` 2.0.4 (та же версия, что у `@react-pdf/font`): им
меряется ширина текста в PDF сертификата.

- `dependencies`: `"@react-pdf/renderer": "4.9.0"` (точный пин) + `package-lock.json`. В отчёт —
  `du -sh node_modules/@react-pdf node_modules/pdfkit node_modules/fontkit`.
- `scripts`: `"db:status": "tsx scripts/db-migrate.ts --status"`, `"db:grants": "tsx scripts/db-grants.ts"`,
  `"ops:preflight": "tsx scripts/ops-preflight.ts"`, `"admin:create": "tsx scripts/create-admin.ts"`,
  `"mail:worker": "tsx scripts/mail-worker.ts"`, `"reminders:send": "tsx scripts/send-reminders.ts"`,
  `"files:sweep": "tsx scripts/files-sweep.ts"`. Файлы скриптов появляются в задачах 3B, 4A, 5A.
  До этого `npm run` по ним падает — это ожидаемо, CI их не вызывает.
- Других зависимостей нет: `nodemailer`, S3-клиент, ClamAV — после решений владельца (§7).

---

## 3. Записи для DECISIONS.md

Записи перенесены в `DECISIONS.md` (D-025…D-037). Источник истины — там.

## 4. Правки документов

### 4.1 `docs/lms/BUILD.md` (оркестратор; отдельный коммит, ревью `reviewer`)

| Раздел | Правка |
|---|---|
| §1 | Строка таблицы `@react-pdf/renderer` — `4.9.0`. Под таблицей: «Шрифты PDF — статические срезы в `assets/fonts/pdf/` (D-036)» |
| §2 | `getDb()`: «ленивая инициализация + миграции (в production — только проверка, D-026) + сид». Новый абзац «**Подготовка БД**»: `prepareDb`, `autoMigrateEnabled`, `assertMigrated`, `DB_MIGRATE_ON_START`; скрипты — по шаблону §2.5 этого плана; `migrate()` напрямую — только `db-migrate`, `db-seed`, снимок демо и тестовая БД. «**Миграции**»: новое имя обязано сортироваться после всех существующих; BIGINT — только время (`*_at`) и деньги (`*_kzt`), другие числа — `INTEGER` (правило снимка). Ссылка на CLI `npm run db:status` |
| §3 | Схема: `auth_tokens`, `mail_outbox` (с `lease_until_at`), `files` (`size_bytes INTEGER`), `lesson_files`, `courses.cover_file_id`, `legal_texts`, новые колонки `consents` (`locale`, `context`, `text_sha256`, `withdrawn_at`, CHECK `kind`). Фраза про `email_verified_at` «поток подтверждения — позже» → «заполняется подтверждением по ссылке или сбросом пароля (D-031)». Таблица блоков: `image` (`fileId`, `alt`, `caption?`, `width`, `height`) и `file` (`fileId`, `label?`, `name`, `ext`, `sizeBytes`); снимки полей переписывает сервер |
| §4 | Пункт «**Файлы урока**»: доступ к `/api/files/[id]` — по `lesson_files` опубликованных уроков и `loadCourseAccess` (без второй реализации), обложки — по видимости курса (D-034) |
| §5 | Абзац «Email не подтверждается…» заменить: сброс пароля и подтверждение email (токены — D-031); при активном `EMAIL_VERIFY` заказ — только с подтверждённого email (`email_unverified`); покупка гостем — D-032; поиск по email и создание при оплате по-прежнему запрещены (D-020). В «Защиту» — лимиты сброса и подтверждения (mail §5, таблица лимитов), лимит PDF (10/мин), лимиты загрузки и выдачи файлов (up §3.2). Добавить: согласия пишутся через `src/lib/legal` (D-035) |
| §6 | Фраза о route handlers → «Route handlers — только для файлов (CSV, PDF, загрузка и выдача) и `/api/health` (D-028)». Строки таблицы: `/password/forgot`, `/password/reset`, `/account/verify` (гость/вошедший, foundation); `/legal`, `/legal/[doc]`, `/legal/[doc]/[version]` (все, **legal**); `/learn/[slug]/certificate/pdf` (владелец сертификата, learn); `/admin/mail`, `/admin/mail/[id]` (admin, **mail**); `/admin/courses/[id]/files` (admin, **files**); `/api/uploads` (admin, **files**); `/api/files/[id]` (по доступу, **files**); `/api/health` (все, **ops**). У `/learn/[slug]/certificate`: «печать браузером или PDF (`CERT_PDF`)» |
| §8 | Namespace: `+ files, legal`. «`messages/{ru,kz}/mail.json` — тексты писем, грузит `src/lib/mail/i18n.ts`, в `NAMESPACES` не входит». Исключения из «тексты только в messages»: юридические документы — `content/legal/**` (контент, D-035); `deploy/nginx/maintenance.html` (приложение недоступно, D-027) |
| §10 | Новые группы тестов: флаги, почта и токены, сброс и подтверждение, напоминания, файлы, юрдокументы, PDF, ops. Только на Postgres: `mail-worker-concurrency`, `reminders-concurrency`, `files-sweep-race`, `ops-grants`, `checkout-concurrency`. «E2E идут на демо с флагами по умолчанию (все включены); выключенный флаг проверяют интеграционные тесты» |
| §11 | Демо: почта — только outbox, ссылки в «Письма»; файлы — во временном каталоге, лимит 4 МБ на Vercel/Netlify; PDF генерируется в функции. Абзац «Прод на сервере ЦРП»: заменить строку «см. issue #24» на ссылку на `docs/ops/RUNBOOK.md`, D-026, D-027 |
| §12 | Фундамент: + `src/lib/{features,audit}.ts`. Новые зоны: **mail** — `src/lib/{mail,reminders}`, `src/app/[locale]/admin/mail`, `messages/*/mail.json`; **files** — `src/lib/{storage,files}`, `src/app/api/{uploads,files}`, `src/components/admin/files`, `messages/*/files.json`; **legal** — `src/lib/legal`, `src/app/[locale]/legal`, `src/components/legal`, `content/legal`, `messages/*/legal.json`; **ops** — `src/lib/ops`, `src/app/api/health`, `deploy/`, `docs/ops/`. PDF — в зоне learn (`src/lib/learn/pdf`), шрифты — `assets/fonts/pdf` |
| §13 (новый) | «**Флаги функций**»: таблица §2.1 этого плана (флаг, что включает, демо, условие вне демо) и правила использования |

### 4.2 `.env.example` (волна 0, полный список новых переменных)

Правка существующей строки:
```
# Публичный адрес платформы: ссылки в письмах и QR сертификатов. Вне демо — обязательно https://,
# иначе почтовые функции и PDF сертификата не включатся (D-025).
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```
К `PGLITE_DIR` дописать: «Если задан, задайте и `STORAGE_DIR` рядом: иначе файлы пропадут при перезапуске».

Новые блоки:
```
# --- Флаги функций (D-025): 1 — включить, 0 — выключить. Пусто: в демо включено, иначе выключено.
# Вне демо функции нужны ещё условия готовности (BUILD.md §13). На сервере ЦРП — 0 до приёмки.
FEATURE_PASSWORD_RESET=
FEATURE_EMAIL_VERIFY=
FEATURE_REMINDERS=
FEATURE_UPLOADS=
FEATURE_LEGAL=
FEATURE_CERT_PDF=

# --- Почта (D-030). outbox — письма только сохраняются и видны в админке «Письма», наружу не уходят.
# Другой транспорт — после решения ЦРП о провайдере (D-009). В демо всегда outbox.
MAIL_TRANSPORT=outbox
# Отправитель и адрес для ответов, например noreply@<домен ЦРП> и рабочий ящик ЦРП.
MAIL_FROM=
MAIL_REPLY_TO=
# Предохранитель: писем сброса пароля и подтверждения email в час на всех. По умолчанию 300.
MAIL_AUTH_HOURLY_CAP=
# Сколько дней хранить письма (очередь и история). По умолчанию 90.
MAIL_RETENTION_DAYS=

# --- Файлы (D-034). Каталог на сервере ЦРП: абсолютный путь вне каталога приложения, входит в бэкап.
# Пусто: в демо — временный каталог, вне демо загрузка недоступна (503).
STORAGE_DIR=
# local (по умолчанию). s3 — после решения ЦРП (хранилище в РК), пока не реализован.
STORAGE_PROVIDER=
# Квоты в байтах: на все файлы и на один курс. По умолчанию 20 ГБ и 2 ГБ.
UPLOAD_QUOTA_BYTES=
UPLOAD_COURSE_QUOTA_BYTES=

# --- БД и выкладка в production (D-026, D-027).
# 1 — накатывать миграции при старте и в production (на сервере ЦРП не задавать). Пусто: в production
# приложение только проверяет миграции и не стартует, если они не накатаны; в демо и разработке накатывает.
DB_MIGRATE_ON_START=
# Сколько ждать блокировку таблицы при миграции, мс (npm run db:migrate). По умолчанию 5000.
MIGRATE_LOCK_TIMEOUT_MS=
# Роли Postgres для npm run db:grants и проверки окружения. На сервере ЦРП — crp_app и crp_owner.
DB_APP_ROLE=
DB_OWNER_ROLE=
# Ключ шифрования server actions, один для всех релизов (openssl rand -base64 32).
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=
# 1 — не отправлять телеметрию Next (она уходит за рубеж). На сервере ЦРП — 1.
NEXT_TELEMETRY_DISABLED=
```
Не добавляются: `SMTP_*` (задача SMTP-адаптера), `BACKUP_*`, `ALERT_*`, `DOMAIN` (только в
`deploy/env/*.example`, ops-only — список исключений в тесте 5B).

### 4.3 `README.md` (оркестратор, коротко)

- Абзац статуса: «За флагами (в демо включены): восстановление пароля и подтверждение email,
  напоминания о сроках, загрузка файлов в конструкторе, юридические документы и согласия,
  PDF сертификата. На проде включаются после приёмки (D-025)».
- В «Посмотреть», после строки про покупку: «В демо письма не отправляются: ссылки для сброса
  пароля и подтверждения email — в админке, раздел „Письма“. Новый покупатель сначала
  подтверждает email по такой ссылке».
- Новый раздел «Прод» (2–3 строки): сервер ЦРП в РК, выкладка и бэкапы — `docs/ops/RUNBOOK.md`,
  первый администратор — `npm run admin:create`, проверка окружения — `npm run ops:preflight`.
- В «С чего начать»: строка «Эксплуатация → `docs/ops/RUNBOOK.md`».

---

## 5. Волны реализации

Общие правила для всех задач:
- **Волна 0** выполняется прямо в ветке `claude/amazing-pascal-agse3o`. Волны 1–5 — каждая задача
  в своём git worktree от текущей головы ветки, не больше двух одновременно. Слияние в ветку
  делает оркестратор после `reviewer` (для T2→T1 — Opus) и зелёных проверок. Следующая волна
  стартует от ветки, где уже есть все слияния предыдущих волн.
- Файлы вне списка задачи не трогать. Нужна правка чужого файла — сообщить оркестратору.
- Коммиты: сначала `messages/*` (только добавления), затем код и тесты. `package.json`,
  миграции, `DECISIONS.md`, `BUILD.md` в задачах волн 1+ не меняются.
- Проверки каждой задачи: `npm run typecheck`, `npm run lint`, `npm run test:unit`,
  `npm run test:integration` (PGlite и `TEST_DATABASE_URL` на Postgres 16), `npm run build` с
  `DEMO_MODE=1`, `npm run test:e2e`. Тест нельзя отключать, чтобы прогон стал зелёным.
- Тексты kz помечаются «требует проверки носителем» (#13); новые строки проходят тесты
  `*-no-slop` и паритета.
- Флаги: проверка только через `isFeatureActive` (§2.1); при выключенном флаге — 404 страниц и
  маршрутов, `unavailable`/`FEATURE_DISABLED` у действий, без записи в БД.

### Волна 0 — фундамент (один исполнитель, прямо в ветке)

**W0-docs** — оркестратор (T0 `mechanic` по готовому тексту) + `reviewer`:
- `DECISIONS.md` — §3 (отдельный коммит);
- `docs/lms/BUILD.md` — §4.1; `README.md` — §4.3 (один коммит `docs(lms): …`);
- комментарии в issue #4, #8, #9, #11, #17, #24, #25: ссылка на план и номер задачи.

**W0-code** — `builder` (T2→T1). Ревью: `reviewer` (Opus); `architect` — `migrate.ts`, `index.ts`,
три миграции.

Файлы (только эти):
- `package.json`, `package-lock.json` — §2.9 (коммит `chore(infra): …`);
- `messages/{ru,kz}/admin.json` (§2.8), `messages/{ru,kz}/{files,legal,mail}.json` = `{}` (коммит `feat(admin): тексты …`);
- `migrations/2026-10-20-{legal-consents,mail-outbox,uploads}.sql` — §2.7 (коммит `feat(infra): миграции …`);
- `next.config.ts` — К-18; `.env.example` — §4.2;
- `src/lib/env.ts` — `isDemo(env)`, `siteUrlConfigured(env)`;
- `src/lib/features.ts` — §2.1;
- `src/lib/audit.ts` (новый); `src/lib/admin/audit.ts` — делегирует (§2.6);
- `src/lib/db/migrate.ts`, `src/lib/db/index.ts` — §2.5 (ops §3.13: A1–A2), с учётом КК-2;
- `src/lib/mail/{types,config}.ts` — §2.2;
- `src/lib/legal/{types,registry}.ts` — §2.3 (`LEGAL_VERSIONS = []`);
- `src/lib/storage/limits.ts`, `src/lib/files/{types,url}.ts` — §2.4;
- `src/lib/content/{types,blocks}.ts` — `ImageBlock`, `FileBlock`, схемы, `LIMITS` (up §3.7);
- заглушки веток `image`/`file` без нового UI: `src/components/admin/lesson/{BlockListEditor,BlockPreview}.tsx`,
  `src/components/admin/lesson/blockModel.ts`, `src/components/learn/Blocks.tsx` и все прочие
  `switch` по `block.type` (найти поиском `case 'divider'`): возврат `null` или блок как есть.
  Кнопок «Изображение» и «Файл» нет;
- `src/lib/admin/errors.ts` — `FEATURE_DISABLED`, `FILE_IN_USE`, `FILE_NOT_FOUND`;
- `src/lib/catalog/queries.ts`, `src/lib/learn/data.ts` — `cover: visibleCover(r.cover, isFeatureActive('UPLOADS'))` (К-8);
- `src/lib/i18n/request.ts` — `NAMESPACES` += `'files'`, `'legal'`;
- `src/lib/auth/{index,session}.ts` — `emailVerified: boolean` в `User`/`SessionUserRow` (mail §3.3);
- тесты: `tests/unit/features.test.ts` (матрица `FEATURE_X` 1/0/пусто/`yes` × демо/production ×
  условия готовности), `tests/unit/mail-config.test.ts` (только транспорт и значения по умолчанию),
  `tests/unit/env-site-url.test.ts`, `tests/unit/ops-migrations-diff.test.ts`,
  `tests/unit/ops-auto-migrate.test.ts`, `tests/unit/core-no-direct-migrate.test.ts` (вызов
  `migrate(` в `src/**` и `scripts/**` — только в разрешённых файлах, К-12),
  `tests/unit/core-blocks.test.ts` (дополнить: схемы `image`/`file`),
  `tests/unit/files-url.test.ts` (`FILE_URL_RE`, `visibleCover`),
  `tests/integration/ops-migration-status.test.ts` (ops §7.2, первый пункт),
  `tests/integration/core-session.test.ts` (поле `emailVerified`).

Готово, когда:
- дерево компилируется, все проверки зелёные, включая `core-migrations` (двойной прогон),
  `demo-snapshot` (правило `*_at`/`*_kzt`) и прогон на Postgres;
- поведение для пользователя не изменилось: e2e без правок проходят;
- `writeAudit` из `src/lib/admin/audit.ts` пишет то же, что раньше;
- в демо `isFeatureActive` даёт true для всех шести флагов; в production без переменных — false;
  с `FEATURE_*=1` — false для почты и `CERT_PDF` без https-адреса и для `LEGAL` с пустым реестром.

### Поправки после ревью волны 0 (обязательны для волн 1–5)

- **1A.** `mail_outbox.to_email` хранить в нижнем регистре: иначе лимит на получателя обходится
  регистром букв. Текст «хранится {days} дней» — параметр из `MAIL_RETENTION_DAYS`.
- **3A.** Обязательное подтверждение email перед заказом (`email_unverified`) и число галочек на
  покупке — предложено, ждёт владельца (D-032, D-035). Делать за флагом и не считать решённым.
- **3B.** Снять запрет блоков image/file в `updateLesson` (волна 0 отклоняет их кодом
  `FEATURE_DISABLED`) вместе с проверкой ссылок. Риск публичного демо решён в D-038 (сделано в 3B): в `isDemo()`
  `/api/files/[id]` отдаёт документы только admin; гость — вход, как вне демо; вошедший не-админ —
  тот же 404, что без доступа; изображения (обложки и картинки уроков) — по обычным правилам. Ключ блокировки
  квоты — в `src/lib/db/locks.ts`. Инвариант `files.course_id = lessons.course_id` отметить в BUILD:
  он сломается, если появится перенос модуля между курсами. Журнал: meta `file.upload` без `name`
  (Ж-5): up §3.4 шаг 12 и угроза #21 обновлены; в `files-upload` проверить отсутствие ключа `name`.
- **4A.** Сид не создаёт строк `mail_outbox`: время в `dedupe_key` и `params` при сдвиге снимка
  не меняется. Скрипты — через `openScriptDb()`.
- **5A.** `/api/health` ловит `MigrationsPendingError` из `getDb()` и отвечает 503. Preflight
  даёт ошибку `ERROR seed_demo_set` при `SEED_DEMO=1` (ops §3.15): в пустую боевую БД сид засеял
  бы админа с опубликованным паролем уже на проверочном старте. `db:status` уже есть (волна 0). После волны 3:
  preflight предупреждает (`WARN`), если в production включены `FEATURE_EMAIL_VERIFY` или
  `FEATURE_LEGAL`: они включают и предложенные правила D-032 (заказ только с подтверждённого
  email) и D-035 (две галочки), которые ждут владельца.
- **После ревью волны 1.**
  - **2A** (добавляется файл `src/lib/auth/tokens.ts`): `consumeToken` берёт блокировки в том же
    порядке, что `issueToken` — сначала `users` (по `token_hash`) `FOR UPDATE`, затем
    `UPDATE auth_tokens`; тест на отсутствие взаимоблокировки при параллельных выдаче и расходе
    (Postgres). `issueToken` возвращает `null` при лимите: действие отвечает так же, как при успехе,
    и ничего не отправляет. После успешного `issueToken` лимиты уже проверены в этой транзакции:
    `enqueueMail` получает признак (например, `capsChecked: true`) и не перепроверяет их, чтобы
    мягкий общий предохранитель не дал `queued: false` после гашения прежней ссылки. Откат при
    `queued: false` — только у транзакций, единственная цель которых письмо (запрос сброса,
    повторная отправка подтверждения); регистрацию (3A) и смену пароля не откатывать.
    Уведомление `password_changed` не входит в лимит получателя (считаются только письма со
    ссылкой-секретом): иначе пять запросов сброса через публичную форму съедают уведомление о
    смене пароля. Для этого 2A правит `src/lib/mail/outbox.ts`; тест: 5 сбросов, затем смена пароля —
    `password_changed` в очереди. `tests/e2e/helpers/mail.ts` (`openLatestMailLink`) впервые
    проверяется в `password-reset.spec.ts`.
  - **3A (после волны 2).** `registerAction` при `isFeatureActive('EMAIL_VERIFY')` вызывает
    `sendVerification(sql, { userId, email, name, locale, next: safeNext(next) })` из
    `src/lib/auth/recovery.ts` в транзакции регистрации; `queued: false` регистрацию не откатывает.
    Страница покупки при неподтверждённом email показывает готовый `VerifyEmailNotice
    variant="checkout"` с `next` на форму покупки. `checkout.spec.ts` проходит подтверждение через
    `openLatestMailLink` (helper исправлен и проверен в 2A). Плашку подтверждения из layout
    (`VerifyEmailNotice` banner) не показывать там, где страница рисует свой вариант (`checkout`), и на
    `/account/verify`; кнопка плашки передаёт `next` текущей страницы. Иначе на покупке две кнопки,
    а нажатие на кнопку плашки гасит письмо с возвратом к покупке. В `checkout.spec` искать кнопку
    внутри варианта checkout. Сид-аккаунт в демо определяется по id
    (`seedId`), а не по домену `@crp.demo`: регистрация на `@crp.demo` в тестах 3A — обычный аккаунт.
  - **3A.** Гонка на границе `effectiveFrom`: после `prepareConsents` сверить версии подготовленных
    согласий (`${CONSENT_DOC[kind]}@${version}`, без дублей, по порядку) с токеном формы; расхождение —
    `legal_changed`, без записи.
  - **4A.** Кнопка «Отправить ссылку для смены пароля» в карточке пользователя вызывает
    `requestPasswordReset({ email, locale: user.locale, actorId })` из `src/lib/auth/recovery.ts`
    (он сам пишет `user.password_reset_request` с `actorId`) и пишет `user.password_reset_link`.
    **После волны 2:** `requestPasswordReset` возвращал `void` и молчал (сид в демо, лимит,
    письмо не встало в очередь) — у админа это ложный успех и ложная запись журнала. 4A сделал
    результат `{ sent: true } | { sent: false; reason: 'not_found' | 'demo_seed' | 'rate_limited' |
    'global_cap' | 'unavailable' }` (`global_cap` — сработал общий часовой предохранитель писем
    категории auth на всех получателей, `MAIL_AUTH_HOURLY_CAP`, по умолчанию 300; `unavailable` —
    флаг выключен или письмо не встало в очередь; в список файлов 4A добавлен
    `src/lib/auth/recovery.ts`), публичное
    `requestPasswordResetAction` по-прежнему всегда отвечает «отправлено», а `sendResetLinkAction`
    пишет `user.password_reset_link` и отвечает `sendResetDone` только при `sent: true`, иначе —
    отдельные тексты (новые ключи `admin.json` в этой задаче разрешены, исключение из К-6). Тест
    admin-users: сид в демо и лимит → нет записи журнала и нет ответа «поставлено в очередь».
  - **4B (D-038).** В демо загруженный документ выдаётся только администратору: у слушателя блок
    «Файл» показывает нейтральную подпись из `files.json` (ключ `block.demoHidden` — 4B добавляет
    его в ru и kz) вместо ссылки «Скачать». Изображения (блок «Изображение», картинки в тексте,
    обложки) показываются как обычно. e2e `uploads.spec.ts` смотрит урок и под админом, и под
    слушателем. Тексты ответов выдачи — `files.download.*` (уже есть после 3B). Ссылка на документ
    прямо в тексте урока (`[…](/api/files/<id>)`) у не-админа в демо выводится подписью
    `block.demoHidden` без `href`: страница передаёт в `Markdown` набор id документов урока
    (из `lesson_files`, `kind = 'document'`); e2e проверяет такую ссылку под слушателем.
  - **4A.** «Письма»: страница за последней — зажать номер до последней страницы; «Писем пока нет»
    только при пустой очереди.

- **5B.** На шаге сборки `deploy.sh` к релизу уже подключён `.env.production`, а миграции идут
  позже: сборка не должна ходить в БД (иначе упадёт на `assertMigrated`). README: вернуть строку
  «Эксплуатация → docs/ops/RUNBOOK.md» и ссылку в разделе «Прод».

### Волна 1

**1A. Почта: ядро, токены, страница «Письма»** — T2→T1, `builder`; ревью Opus.
- ТЗ: mail §2 (таблицы уже есть), §3.2 (`tokens.ts`), §3.4 (кроме `mailFeature`), §3.6
  (`listMail`, `getMailView`, страницы списка и письма, пункт меню; кнопки напоминаний **нет**),
  §5 (угрозы 4, 5, 12, 13, 16, 20, 21), контракт §2.2 этого плана.
- Файлы: `src/lib/mail/{config,outbox,links,render,layout,i18n,templates,transport,admin,index}.ts`;
  `src/lib/auth/tokens.ts`; `src/app/[locale]/admin/mail/page.tsx`, `src/app/[locale]/admin/mail/[id]/page.tsx`;
  `src/components/admin/mail/**` (новые, если нужны); `src/components/admin/AdminNav.tsx`;
  `src/app/[locale]/admin/layout.tsx` (проп `mailPages`); `messages/{ru,kz}/mail.json`;
  `tests/unit/{mail-render,auth-tokens}.test.ts`, `tests/unit/mail-config.test.ts` (дополнить);
  `tests/integration/{mail-outbox,admin-mail,auth-tokens}.test.ts`; `tests/e2e/helpers/mail.ts`.
- Готово: письма всех 7 шаблонов собираются на ru и kz (тексты и HTML по BRAND, без «→» и «!»);
  `enqueueMail` с лимитами и `dedupeKey`; `issueToken`/`consumeToken` с гашением прежних;
  «Письма» — список с фильтром и письмо, ссылка видна только в демо; пункт меню виден при любом
  активном почтовом флаге.
- Тесты: mail §7 — `mail-render`, `mail-config`, `auth-tokens` (unit), `mail-outbox`,
  `admin-mail`; интеграционный `auth-tokens`: выдача гасит прежний токен и отменяет его письмо,
  повторное использование и истечение → `null`, смена email → `null`.

**1B. Юридические документы: ядро, тексты-заглушки, страницы, подвал** — T2→T1, `builder`; ревью Opus.
- ТЗ: legal §2.2, §3.1 (без `flags.ts`, см. §2.3 плана), §3.2, §3.3 — только «Подвал»,
  §4.1 (сценарии 1 и 7), §4.2–4.3 (без `consent.offerRequired`/`pdRequired`), §4.5, §5, шаги A1–A2.
- Файлы: `src/lib/legal/**`; `content/legal/**` (8 заглушек); `src/app/[locale]/legal/**`;
  `src/components/legal/**`; `src/components/layout/Footer.tsx`; `messages/{ru,kz}/legal.json`;
  `tests/unit/legal-{source,registry,no-slop}.test.ts`;
  `tests/integration/legal-{migration,consents}.test.ts`; `tests/e2e/legal.spec.ts`.
- Готово: реестр с хэшами 8 файлов, `legalPublishable()` = false (все черновики); страницы списка,
  документа и архивной редакции; в демо — плашка «Черновик»; колонка «Документы» в подвале при
  активном `LEGAL`; `prepareConsents`, `consentTokenFresh`, `insertConsents`, `listUserConsents`
  готовы, но регистрация и заказ их ещё не вызывают.
- Тесты: legal §7.1 (`legal-source`, `legal-registry`, `legal-no-slop`), §7.2 (`legal-migration`,
  `legal-consents`), §7.3 `legal.spec.ts`. `legalPublishable` с реальным реестром проверяет
  `legal-registry`; `features.test.ts` (W0) не меняется.

### Волна 2

**2A. Сброс пароля и подтверждение email** — T2→T1, `builder`; ревью Opus (сессии, токены). Зависит от 1A.
- ТЗ: mail §3.3 (кроме правки `registerAction` — это 3A), §4 (сценарии 1, 2 и ключи `auth.json`),
  §5 (таблица лимитов, угрозы 1, 3, 5–8, 10, 14, 15, 22, журнал), §6, К-22 этого плана.
- Файлы: `src/lib/auth/{recovery,recoveryActions,rateLimit}.ts`; `src/app/[locale]/password/**`;
  `src/app/[locale]/account/**`; `src/app/[locale]/login/{page,LoginForm}.tsx`;
  `src/app/[locale]/layout.tsx` (`<VerifyEmailNotice />`); `src/components/account/**`
  (`VerifyEmailNotice` с вариантом `checkout` и демо-подсказкой, `ResendVerification`);
  `messages/{ru,kz}/auth.json`; `tests/integration/{auth-recovery,auth-verify}.test.ts`,
  `tests/integration/fixtures/auth-recovery.flow.ts`; `tests/e2e/{password-reset,smoke}.spec.ts`.
- Готово: «Забыли пароль?» → письмо в «Письмах» → новый пароль, все прочие сессии закрыты,
  email подтверждён, письмо «Пароль изменён»; подтверждение по ссылке (POST, без входа);
  плашка для неподтверждённых; повторная отправка с лимитом; в демо сброс для сид-аккаунтов
  молча не выполняется.
- Тесты: mail §7 — `auth-recovery` полностью; `auth-verify` без пункта «регистрация при
  флаге» (вызывать `sendVerification` напрямую); e2e `password-reset.spec.ts` (регистрация
  нового пользователя без покупки), `smoke.spec.ts` — ссылка «Забыли пароль?».

**2B. PDF сертификата** — T2→T1, `builder`; ревью Opus (ПДн в файле). Независима.
- ТЗ: legal §1.2, §3.4–3.7, §4.4, §5 (строки о PDF), §6 (столбец `CERT_PDF`), шаги B1–B4.
  Проверка флага — `isFeatureActive('CERT_PDF')`; при неактивном — прежняя печать и 404 маршрута.
  `getCourse` — из `src/lib/learn/data.ts` (КК-10).
- Файлы: `scripts/fonts/**`; `assets/fonts/pdf/**`; `src/lib/learn/pdf/**`;
  `src/lib/learn/limits.ts`; `src/app/[locale]/learn/[slug]/certificate/page.tsx`,
  `src/app/[locale]/learn/[slug]/certificate/pdf/route.ts`; `src/app/[locale]/learn/page.tsx`;
  `src/components/learn/CertificatePdfLink.tsx` (новый; остальные файлы `components/learn` не
  трогать, К-9); `messages/{ru,kz}/learn.json`; `tests/helpers/ttf-cmap.ts`;
  `tests/unit/learn-pdf-{layout,fonts,config}.test.ts`; `tests/integration/learn-certificate-pdf.test.ts`;
  `tests/e2e/learn.spec.ts`.
- Нет сети или `fonttools` для сборки срезов — остановиться и сообщить оркестратору (сборка вне
  песочницы). Шрифты из других источников не подставлять.
- Готово: «Скачать PDF» отдаёт A4 альбомный по BRAND на языке сертификата, QR ведёт на
  `/{locale}/cert/{number}`; чужой — 404, гость — на вход; 304 по ETag; лимит 10/мин.
- Тесты: legal §7.1 (`learn-pdf-layout`, `learn-pdf-fonts`, `learn-pdf-config`), §7.2
  (`learn-certificate-pdf`, включая kz-ФИО и «нет email в байтах»), §7.3 (`learn.spec.ts`).

### Волна 3

**3A. Регистрация и покупка: согласия с хэшем и подтверждённый email** — T2→T1, `builder`;
ревью Opus обязательно (деньги, ПДн). Зависит от 1B и 2A.
- ТЗ: legal §3.3 «Регистрация», «Заказ», «Сид», §4.1 (сценарии 2–3), §5 (подмена версии,
  согласие за другого); mail §3.3 (правка `registerAction`), §3.8, §4 (сценарии 3–4);
  К-3, К-4, К-19, К-22 этого плана.
- Порядок в `registerAction`: лимиты → поля → галочка → `consentTokenFresh(legalToken,
  REGISTER_CONSENTS)` (иначе `legal_changed`, пользователь не создаётся) → `prepareConsents`
  → `hashPassword` → транзакция: `INSERT users` → `insertConsents(context 'register')` →
  если `isFeatureActive('EMAIL_VERIFY')`, то `sendVerification(sql, { …, next: safeNext(next) })` →
  журнал → вход.
- Порядок в `createOrder`: `SELECT … FOR UPDATE` пользователя с `email_verified_at` →
  `requireVerifiedEmail` (по умолчанию `isFeatureActive('EMAIL_VERIFY')`) и NULL →
  `OrderError('email_unverified')` до любых записей → прежние проверки → `insertConsents(context
  'checkout')` только для нового заказа. Server action: `consentTokenFresh(legalToken,
  CHECKOUT_CONSENTS)` → `legal_changed`; `prepareConsents` до `createOrder`.
- Файлы: `src/lib/auth/actions.ts`; `src/app/[locale]/register/**`;
  `src/lib/orders/{types,validation,create,actions}.ts`; `src/components/checkout/CheckoutForm.tsx`;
  `src/app/[locale]/courses/[slug]/buy/**`; `src/lib/db/seed/activity.ts` (`LEGACY_CONSENT_VERSION`);
  `messages/{ru,kz}/checkout.json`; `tests/unit/checkout-validation.test.ts`;
  `tests/integration/{core-auth-actions,checkout-orders,checkout-concurrency,checkout-email-verify,auth-verify}.test.ts`
  (в `auth-verify` — только пункт про регистрацию); `tests/integration/fixtures/auth-actions.flow.ts`;
  `tests/e2e/checkout.spec.ts`.
- Готово: регистрация с подписью-ссылками и токеном версий; при активном `LEGAL` согласие с
  хэшем, языком и контекстом; письмо подтверждения в транзакции регистрации; покупка — две
  галочки; неподтверждённый email → панель «Заказ можно оформить после подтверждения» (в демо —
  с подсказкой про «Письма»); после подтверждения — возврат на форму покупки. При выключенных
  флагах всё работает как до плана (легаси-согласия, одна галочка, без проверки email).
- Тесты: legal §7.1 `checkout-validation`, §7.2 (`core-auth-actions` + фикстура,
  `checkout-orders`, `checkout-concurrency` — одна строка `legal_texts` при параллельных
  заказах), §7.3 (две галочки); mail §7 `checkout-email-verify` (сценарий #25 целиком и
  `FEATURE_EMAIL_VERIFY=0`), `auth-verify` (регистрация при флаге и без), e2e
  `checkout.spec.ts` через `openLatestMailLink` (§6 ниже).

**3B. Загрузка файлов: сервер** — T2→T1, `builder`; ревью Opus (файлы, доступ). Зависит только от W0.
- ТЗ: up §3.2–3.6, §3.7 (встраивание в `updateLesson`), §5, §6 (серверные строки, без витрины —
  `visibleCover` уже в W0), §7 (unit и integration), шаг 2A по порядку up §8. Журнал — §2.6
  (`course.cover_set`/`course.cover_clear`). `files-sweep` работает и при выключенном флаге (К-11),
  открывает БД по шаблону §2.5.
- Файлы: `src/lib/storage/**`; `src/lib/files/**` (`types.ts`, `url.ts` из W0 можно дополнять,
  не меняя сигнатур §2.4); `src/app/api/uploads/route.ts`; `src/app/api/files/[id]/route.ts`;
  `scripts/files-sweep.ts`; `src/lib/admin/lessons.ts` (только `resolveLessonFiles`/`syncLessonFiles`
  и `files` в журнале); `tests/helpers/fileFixtures.ts`; `tests/unit/files-*.test.ts`;
  `tests/integration/files-*.test.ts`.
- Готово: загрузка, выдача с заголовками up §3.6, `lesson_files`, обложка, удаление, подметание,
  квоты под advisory-блокировкой; `admin-lessons` по-прежнему зелёный.
- Тесты: up §7 — все unit (`files-sniff`, `files-strip-meta`, `files-names`, `files-storage-key`,
  `files-config`, `files-refs`, `files-http-headers`) и integration (`files-upload`,
  `files-lesson-refs`, `files-access`, `files-download`, `files-upload-http`, `files-admin`,
  `files-sweep`, `files-sweep-race` — только Postgres).

### Волна 4

**4A. Напоминания, воркер очереди, карточка пользователя** — T2→T1, `builder`; ревью Opus
(изоляция организаций, ПДн в письмах). Зависит от 1A, 1B, 2A.
- ТЗ: mail §3.5 (с `lease_until_at`, К-10, шаблон §2.5), §3.6 (кнопка «Сформировать
  напоминания», `runRemindersAction`, кнопка «Отправить ссылку для смены пароля» и
  `sendResetLinkAction`), §3.7, §5 (угрозы 11, 17–19), §6 «Напоминания в демо»; legal §3.3
  «Админка» и шаг A4 (блок «Согласия» по `listUserConsents`).
- Файлы: `src/lib/mail/{worker,adminActions}.ts`; `src/lib/reminders/**`;
  `scripts/{mail-worker,send-reminders}.ts`; `src/lib/team/assign.ts` (вызов
  `queueAssignmentNotices` в транзакции); `src/app/[locale]/admin/mail/page.tsx` (только кнопка и
  её результат); `src/lib/admin/actions.ts` (`sendResetLinkAction`);
  `src/app/[locale]/admin/users/[id]/page.tsx`; `src/components/admin/UserForms.tsx`;
  `src/components/admin/UserConsents.tsx` (новый);
  `tests/unit/{reminders-select,mail-worker-backoff}.test.ts`;
  `tests/integration/{mail-worker,mail-worker-concurrency,reminders,reminders-concurrency,team-assign,admin-users}.test.ts`;
  `tests/e2e/reminders.spec.ts`.
- Готово: в демо «Сформировать напоминания» даёт 2 «срок прошёл», 1 «скоро срок» и сводку
  `manager@crp.demo`, повтор — «Новых напоминаний нет»; воркер с арендой и повторами; при
  outbox скрипт выходит с кодом 0; карточка пользователя — кнопка ссылки (при `PASSWORD_RESET`)
  и блок согласий (при `LEGAL`; легаси-строки помечены).
- Тесты: mail §7 — `reminders-select`, `mail-worker-backoff`, `mail-worker`,
  `mail-worker-concurrency`, `reminders`, `reminders-concurrency`, `reminders.spec.ts`;
  `team-assign` — письмо `assignment_new`, без дубля при повторе; `admin-users` — блок согласий
  только админу, `sendResetLinkAction` пишет `user.password_reset_link`.

**4B. Загрузка файлов: интерфейс** — T1, `builder`; ревью `reviewer`. Зависит от 3B.
- ТЗ: up §3.8, §4 (сценарии и `files.json`), §6 (строки UI), шаг 2B (без `visibleCover`);
  флаги и лимиты передаются пропсами со страниц.
- Файлы: `src/components/admin/files/**`; `src/components/admin/lesson/**`;
  `src/app/[locale]/admin/courses/[id]/page.tsx`;
  `src/app/[locale]/admin/courses/[id]/lessons/[lessonId]/page.tsx`;
  `src/app/[locale]/admin/courses/[id]/files/page.tsx`;
  `src/components/learn/{ImageBlock,FileBlock,Blocks,Markdown}.tsx`;
  `src/app/[locale]/learn/[slug]/[lesson]/page.tsx` (проп `filesEnabled`);
  `messages/{ru,kz}/files.json`; `tests/e2e/uploads.spec.ts`.
- Готово: блоки «Изображение» и «Файл», «Вставить картинку», обложка, страница «Файлы курса»,
  показ слушателю; в демо — предупреждение о ПДн и лимит 4 МБ на Vercel и Netlify.
- Тесты: up §7 E2E (`uploads.spec.ts`, 6 сценариев); `admin.spec.ts` и `learn.spec.ts` остаются
  зелёными без правок.

### Волна 5

**5A. Эксплуатация: код приложения** — T2→T1, `builder`; ревью Opus, `architect` — `grants.sql`.
Зависит только от W0.
- ТЗ: ops §2.1–2.3, §3.13 (`db-migrate --status`, `lockTimeoutMs` в CLI, `db-grants.ts`),
  §3.14–3.16, §5, шаги A3–A6. `create-admin` пишет журнал через `src/lib/audit.ts` (§2.6),
  открывает БД по шаблону §2.5.
- Файлы: `src/lib/ops/**`; `src/app/api/health/route.ts`;
  `scripts/{db-migrate,db-grants,ops-preflight,create-admin}.ts`; `deploy/postgres/{roles,grants}.sql`;
  `tests/unit/ops-{release,preflight}.test.ts`;
  `tests/integration/ops-{health,create-admin,preflight-db,grants}.test.ts`; `tests/e2e/ops-health.spec.ts`.
- Готово: `/api/health` (200/503, без деталей); preflight с кодами ошибок без значений;
  `create-admin` без пароля в argv; `db:status` с кодами 0/3/1; `grants.sql` идемпотентен.
  Preflight использует `featureBlockers`/`isFeatureEnabled` для `WARN feature_on:<NAME>`.
- Тесты: ops §7.1 (`ops-release`, `ops-preflight`), §7.2 (`ops-health`, `ops-create-admin`,
  `ops-preflight-db`, `ops-grants` — только Postgres), §7.3 (`ops-health.spec.ts`).

**5B. Эксплуатация: комплект выкладки и RUNBOOK** — `deploy.sh`, `rollback.sh`, `backup.sh`,
`restore.sh` — T2→T1 (ревью `architect`); остальное — T1. Параллельно с 5A: стыки закреплены ops §8.3.
- ТЗ: ops §3.1–3.12, §4.3, §5, §7.4 (чек-лист в RUNBOOK §10), шаги B1–B5. Крон — К-10, имена
  скриптов — `mail-worker`, `send-reminders`, `files-sweep`; `files-sweep` без проверки флага
  (К-11). CSP у `/api/files/` не убирать (КК-13).
- Файлы: `deploy/**`, кроме `deploy/postgres/{roles,grants}.sql`; `docs/ops/**`;
  `tests/unit/ops-{deploy-files,no-secrets,scripts}.test.ts`; `tests/fixtures/ops-shims/**`;
  `.github/workflows/ci.yml` (по желанию — установка `shellcheck`).
- Готово: скрипты проходят `bash -n` и тест на шимах; в `deploy/**` и `docs/ops/**` нет IP,
  ключей и паролей; `deploy/env/app.env.example` ⊆ `.env.example` (исключения — ops-only:
  `BACKUP_*`, `ALERT_*`, `DOMAIN`).
- Тесты: ops §7.1 (`ops-deploy-files`, `ops-no-secrets`, `ops-scripts`).

Если владелец даст сервер раньше, волну 5 можно поставить на место волны 4: её зоны
пересекаются только с W0.

### Волна 5 — хвосты после ревью

Ревью волны 5 нашло вопросы доступа и расхождения документов. Решения — D-039 (повышение до
админа), D-040 (сид в production), D-041 (граница пользователей ОС); ops.md сведён с кодом и
комплектом. Задачи ниже независимы по файлам и идут параллельно (не больше двух worktree сразу).

**5A-хвосты. create-admin и сид в рантайме** — T2→T1, `builder`; ревью Opus (доступы, сид).
Зависит от 5A.
- ТЗ: D-039, D-040; ops §3.13 «Сид в рантайме», §3.16.
- Файлы: `src/lib/ops/{createAdmin,createAdminArgs}.ts`; `scripts/create-admin.ts`;
  `src/lib/db/seed-guard.ts`; `src/lib/db/index.ts` (только `shouldSeed` и предупреждение);
  `scripts/db-seed.ts` (только если меняется текст); `.env.example` (только комментарий к
  `SEED_DEMO`); `tests/integration/{ops-create-admin,ops-db-seed}.test.ts`;
  `tests/unit/{db-seed-guard,ops-create-admin-text}.test.ts` (новые);
  `tests/integration/db-seed-runtime.test.ts` (новый).
- Шаги:
  1. `seed-guard.ts`: `export function seedPermitted(env = process.env): boolean` —
     `isDemo(env) || (env.SEED_DEMO?.trim() === '1' && env.NODE_ENV !== 'production')`.
     `seedRefusal` = `seedPermitted ? null : текст`; при `SEED_DEMO=1` и `NODE_ENV=production`
     текст свой: «SEED_DEMO=1 в production не действует без DEMO_MODE=1: демо-учётки с
     публичным паролем в боевую базу не пишутся. Администратора создаёт admin:create». Без
     пароля, адреса БД и значений переменных.
  2. `index.ts`: `shouldSeed()` = `seedPermitted(process.env)`. Если `SEED_DEMO=1`, а сид не
     разрешён, — один `console.warn` на процесс (флаг на `globalThis`, как
     `__crpSnapshotWarned`): «SEED_DEMO=1 проигнорирован: production без DEMO_MODE=1». Не
     бросать: приложение работает, опасное действие просто не выполняется.
  3. `createAdminArgs.ts`: булев флаг `--identity-confirmed` (форма `=…` — usage); без
     `--promote` — usage. Поле `identityConfirmed` в `CreateAdminArgs`. Обновить
     `CREATE_ADMIN_USAGE`. Чистая функция `unverifiedMessage(env = process.env): string`:
     всегда — про `--identity-confirmed` («сотрудник рядом и лично подтвердил, что адрес и ящик
     его; он задаст новый пароль, все сессии аккаунта закроются, адрес будет отмечен
     подтверждённым»); фраза «или пусть сотрудник подтвердит адрес письмом или восстановлением
     пароля» — только при `isFeatureActive('EMAIL_VERIFY', env) || isFeatureActive('PASSWORD_RESET', env)`.
  4. `createAdmin.ts`: вход `identityConfirmed?: boolean`; результат + `sessionsRevoked: number`,
     `identityConfirmed: boolean`. Пароль при `promote && identityConfirmed` обязателен (нет —
     `validation`), проверяется как при создании (`passwordProblem`, ≥ 12 — иначе
     `weak_password`), хэш — до транзакции. В транзакции после `SELECT … FOR UPDATE`:
     уже `admin` → ничего не менять, журнала нет; `email_verified_at IS NULL && !identityConfirmed`
     → `unverified`; иначе `UPDATE users SET role='admin'` (+ при `identityConfirmed`
     `password_hash`, `email_verified_at = COALESCE(email_verified_at, t)`), `DELETE FROM sessions
     WHERE user_id = … RETURNING id` → `sessionsRevoked`; при `identityConfirmed` ещё
     `UPDATE auth_tokens SET used_at = t WHERE user_id = … AND used_at IS NULL` и `cancelSecrets`
     (`src/lib/mail/outbox.ts`) для `password_reset` и `email_verify`. Журнал — один
     `user.role_change` через `writeAudit`, `actorId: null`, meta `{to:'admin', via:'cli',
     sessionsRevoked}` (+ `{identity:'offline', passwordReset:true, emailVerified:<был NULL>}`).
     Новых действий журнала нет. Обновить комментарий в начале блока promote: «пароль, имя и
     сессии не трогаем» больше не верно.
  5. `scripts/create-admin.ts`: пароль читается при `!promote` или `promote && identityConfirmed`;
     для `unverified` — `unverifiedMessage()`; коды выхода без изменений (`unverified` — 3).
     Вывод: «Роль admin выдана: <id>. Закрыто сессий: N.»; с `--identity-confirmed` ещё
     «Пароль заменён, адрес отмечен подтверждённым.»; уже админ — «Пользователь уже
     администратор, ничего не менялось: <id>». Email и пароль не печатаются.
  6. `.env.example`: комментарий к `SEED_DEMO` — «только разработка и тесты; в production без
     DEMO_MODE=1 не действует (D-040)».
- Готово: `--promote` закрывает сессии повышаемого и только его; неподтверждённый адрес без
  флага — код 3, ничего не изменено, сообщение не советует недоступного в production; с
  `--identity-confirmed` — новый пароль, адрес подтверждён, сессии и ссылки погашены, один
  `user.role_change` без ПДн; `SEED_DEMO=1` в production без `DEMO_MODE=1` не сеет ни
  `getDb()`, ни `db:seed`, приложение при этом стартует; Netlify (`NODE_ENV=production`,
  `DEMO_MODE=1`) и e2e сеют как раньше.
- Тесты:
  - `tests/unit/db-seed-guard.test.ts` — матрица `seedPermitted`: `{DEMO_MODE:1, NODE_ENV:production}`
    → true; `{NODE_ENV:production, DATABASE_URL, SEED_DEMO:1}` → false; то же + `DEMO_MODE:1` →
    true; `{NODE_ENV:development|test, DATABASE_URL, SEED_DEMO:1}` → true; `{DATABASE_URL}` →
    false; `{}` → true; `{VERCEL:1, NODE_ENV:production}` → true; `{DATABASE_URL, SEED_DEMO:1}`
    без `NODE_ENV` → true (скрипт под tsx; остаточный риск D-040). `seedRefusal` в production —
    текст без `demo12345`, пароля и хоста из `DATABASE_URL`.
  - `tests/integration/db-seed-runtime.test.ts` (отдельный файл: меняет `process.env` и проверяет
    «один раз на процесс») — пустая мигрированная БД (`createTestDb({ register: false })`),
    `NODE_ENV=production`, `SEED_DEMO=1`, без `DEMO_MODE`: `prepareDb(db, { autoMigrate: false })`
    дважды → `users` пуста, `console.warn` с «SEED_DEMO» ровно один раз; затем `DEMO_MODE=1` →
    `prepareDb` засевает. Окружение восстанавливается в `finally`.
  - `tests/integration/ops-db-seed.test.ts` — `db-seed` с `PGLITE_DIR`, `NODE_ENV=production`,
    `SEED_DEMO=1` → код 1, `users` пуста, в stderr нет `demo12345`; прежние проверки остаются.
  - `tests/integration/ops-create-admin.test.ts` — по ops §7.2: сессии повышаемого удалены, чужие
    целы, `meta` = `{to, via, sessionsRevoked}`; уже админ — сессии целы, журнала нет;
    `unverified` — сессии и роль целы; `identityConfirmed`: хэш новый (`verifyPassword`), старый не
    подходит, `email_verified_at` задан, `sessions` пуста, все `auth_tokens` с `used_at`, письма с
    секретами `cancelled` и без `secret`, в журнале нет email и имени; без пароля → `validation`,
    короткий → `weak_password`, ничего не изменено; разбор: `--identity-confirmed` без `--promote`
    и `--identity-confirmed=1` → usage. CLI (как существующие, `PGLITE_DIR` + `--allow-demo`):
    `--promote --identity-confirmed --password-stdin` → код 0, ни email, ни пароль не напечатаны;
    `--promote` неподтверждённого с `FEATURE_EMAIL_VERIFY=0 FEATURE_PASSWORD_RESET=0` → код 3, в
    stderr есть `--identity-confirmed` и нет «подтвердит адрес письмом».
  - `tests/unit/ops-create-admin-text.test.ts` — `unverifiedMessage`: production-окружение с
    выключенными флагами — без фразы о письме; демо — с ней; оба — с `--identity-confirmed`.

**5B-хвосты. Комплект: вторая копия файлов, offsite, граница пользователей ОС** —
`backup.sh`, `healthcheck.sh`, `install-ops.sh` — T2→T1 (ревью `architect`); остальное — T1.
Зависит от 5B.
- ТЗ: D-041; ops §3.1 (пометки «5B-хвосты»), §3.7, §3.9, §3.10, §3.16 (текст для RUNBOOK §3).
- Файлы: `deploy/bin/{backup,healthcheck,install-ops,restore}.sh`; `deploy/cron/crp.cron`;
  `deploy/logrotate/crp`; `deploy/env/backup.env.example`; `docs/ops/RUNBOOK.md`;
  `tests/unit/{ops-scripts,ops-deploy-files}.test.ts`; `tests/fixtures/ops-shims/**`.
- Шаги:
  1. Вторая копия файлов: в `backup.sh --files` адрес `BACKUP_FILES_REMOTE` и ключ
     `BACKUP_FILES_REMOTE_SSH_KEY`; пустые — запасные `BACKUP_REMOTE` и `BACKUP_REMOTE_SSH_KEY`.
     Пример и комментарий в `deploy/env/backup.env.example` (ключ для files — свой, `crp` 0600,
     свой каталог и `rrsync -wo -no-del -no-overwrite`); RUNBOOK §6.1 — как завести два ключа.
  2. `healthcheck.sh check_offsite`: `backup-status.json` — при заданном `BACKUP_REMOTE`;
     `files-status.json` — только если `STORAGE_DIR` непуст (то же условие, что `backup_files`),
     задан `BACKUP_FILES_REMOTE` или `BACKUP_REMOTE`, и статус моложе 26 ч (старый статус уже
     даёт `backup_files=fail`, второй раз его не учитываем).
  3. D-041, журнал бэкапа БД: `/var/log/crp-backup/backup.log` (каталог postgres:adm 0750 создаёт
     `install-ops.sh`), строки крона, блок logrotate `su postgres adm`; `/var/log/crp` — 0750
     crp:adm. RUNBOOK §1, §7, §8 (таблица «что делать»): новые пути; на уже установленном сервере
     старый `/var/log/crp/backup/` удалить после переноса.
  4. D-041, статусы: `/var/lib/crp-ops` — 1775 postgres:crp (sticky: crp не удаляет и не
     переименовывает файлы postgres). `backup.sh write_status`: временный файл через `mktemp` в
     `$OPS_DIR`, `chmod 644` временного файла, затем `mv -f`; `chmod` после `mv` убрать (он шёл бы
     по подменённой ссылке). То же — для `monitor-state.json` в `healthcheck.sh`.
  5. `restore.sh --force-prod`: порт проверки «приложение остановлено» из
     `shared/instance.json` (если читается), иначе `CRP_APP_PORT`/3000.
  6. RUNBOOK §3: `--promote` (сессии закрываются, человек входит заново) и порядок
     `--promote --identity-confirmed`: сотрудник рядом, сам читает адрес в команде, подтверждает
     ящик и вводит новый пароль; коды выхода 0/2/3/1; в журнал — только `user.role_change` без ПДн.
- Готово: файлы и база получают вторую копию разными ключами; устаревший или ненужный
  `files-status.json` не включает `backup_offsite`; ни один путь, куда пишет `postgres`, не лежит
  в каталоге, где `crp` может подменить файл или подкаталог.
- Тесты: `ops-scripts` — `--files` передаёт в ssh `-i <BACKUP_FILES_REMOTE_SSH_KEY>` и шлёт в
  `BACKUP_FILES_REMOTE`; без них — запасные общие; `check_offsite`: пустой `STORAGE_DIR` и
  `files-status.json` с `offsite=false` → проверки нет или `ok`; статус старше 26 ч не учитывается;
  подложенная ссылка `<status>.tmp`/предсказуемое имя не трогает цель, статус 0644, временных
  файлов не остаётся. `ops-deploy-files` — путь журнала бэкапа в cron и logrotate,
  `install-ops.sh` ставит `/var/log/crp` 0750 и `/var/lib/crp-ops` 1775.

**4B-e2e. Устойчивость `uploads.spec.ts`** — T1, `builder`; сделано
(`bc34f0f`, `49ed5e5`): независимость от прежнего состояния через уникальную подпись прогона,
перекрытие двух загрузок через `page.route`, правки урока при задержанном ответе загрузки.
- Хвост: перед каждым `expect.poll(… naturalWidth …)` — `await img.scrollIntoViewIfNeeded()`:
  после 4+ попыток на одном сервере в уроке много блоков, ленивая картинка вне экрана не
  грузится, и опрос висит до таймаута.
- Файлы: `tests/e2e/uploads.spec.ts`.
- Готово и критерий: три прогона `uploads.spec.ts` подряд на одном заранее запущенном `next start`
  (`DEMO_MODE=1`, без перезапуска между прогонами) — зелёные; полный `npm run test:e2e` зелёный.

**mail-хвосты** — T1, `builder` или `mechanic` для текста.
- `docs/lms/design/mail-account.md` (~стр. 410, `purgeMail`): «удаляет письма старше
  `MAIL_RETENTION_DAYS` (не меньше 31: меньшее значение поднимается до 31 с одним
  предупреждением на процесс)».
- `src/lib/mail/worker.ts` (~стр. 172, комментарий `purgeMail`): то же уточнение.
- Тест: новый файл `tests/unit/mail-retention-warn.test.ts` — `mailRetentionDays` с `'10'`,
  `'5'` и снова `'10'` → `console.warn` ровно один раз. Отдельный файл обязателен: флаг
  предупреждения модульный, а `node --test` запускает каждый файл в своём процессе
  (`mail-config.test.ts` уже вызывает предупреждение в своём процессе).

**Вне волны 5** (заводятся issue):
- зона admin (T1, ревью Opus): `changeRole` в `src/lib/admin/users.ts` при повышении до `admin`
  закрывает сессии пользователя в той же транзакции (правило D-039 для UI); `meta` журнала без
  `name` (PLAN §2.6: без ФИО), подпись берёт имя по `entityId`;
- оркестратор (T0): BUILD §2 «Сид» — условие сида по D-040.

### Итог (после волны 5)

- `tester` (T1): полный прогон на PGlite и Postgres 16, сборка, e2e; отчёт о флаки-тестах.
- `reviewer` (T2): весь дифф от начала волны 0 — токены и сессии, заказ и согласия, доступ к
  файлам и PDF, журнал без ПДн, флаги в проде, отсутствие секретов в `deploy/`.
- Оркестратор: синхронизация описательных частей BUILD/README с кодом, handoff, issue из §7.

### Сводка

| Волна | Задачи (параллельно) | Уровень | Зависит от |
|---|---|---|---|
| 0 | W0-docs (оркестратор) → W0-code | T0 / T2→T1 | — |
| 1 | 1A почта: ядро и «Письма» ‖ 1B юрдокументы: ядро и страницы | T2→T1 ‖ T2→T1 | W0 |
| 2 | 2A сброс пароля и подтверждение ‖ 2B PDF сертификата | T2→T1 ‖ T2→T1 | 1A ‖ W0 |
| 3 | 3A регистрация и покупка ‖ 3B файлы: сервер | T2→T1 ‖ T2→T1 | 1B, 2A ‖ W0 |
| 4 | 4A напоминания, воркер, карточка ‖ 4B файлы: интерфейс | T2→T1 ‖ T1 | 1A, 1B, 2A ‖ 3B |
| 5 | 5A ops: код ‖ 5B ops: комплект и RUNBOOK | T2→T1 ‖ T2→T1/T1 | W0 ‖ W0 |
| 5-хвосты | 5A-хвосты ‖ 5B-хвосты; 4B-e2e, mail-хвосты | T2→T1 ‖ T2→T1/T1; T1, T1 | 5A ‖ 5B; 4B, 4A |
| итог | регрессия и ревью | T1 + T2 | все |

Пересечение зон внутри волн проверено по спискам файлов: общих путей нет.
`src/app/[locale]/admin/mail/page.tsx` создаёт 1A и дополняет 4A, `src/app/[locale]/layout.tsx`
меняет только 2A, `src/lib/auth/actions.ts` — только 3A. Эти задачи идут в разных волнах.

---

## 6. Что ломается в существующих тестах и где чинится

| Тест | Почему ломается | Чинит |
|---|---|---|
| `tests/integration/core-session.test.ts` | в объекте пользователя появилось `emailVerified` | W0 |
| `tests/integration/demo-snapshot.test.ts` | сломался бы на `locked_until` и `size_bytes BIGINT` — в миграциях плана их нет (КК-1) | W0 (прогон) |
| `tests/unit/core-blocks.test.ts` | новые типы блоков в объединении | W0 (дополнить) |
| `tests/e2e/admin.spec.ts` | новый пункт меню «Письма» (при `getByRole` по точному имени возможен сдвиг) | 1A |
| `tests/e2e/learn.spec.ts` | при `CERT_PDF` (в демо включён) кнопка сертификата — ссылка на PDF, а не печать | 2B |
| `tests/integration/core-auth-actions.test.ts` + `fixtures/auth-actions.flow.ts` | `LEGAL` в тестах активен: без `legalToken` → `legal_changed`; согласие пишется с хэшем, языком и контекстом, а не `version '2026-10-19'`; при `EMAIL_VERIFY` регистрация ставит письмо | 3A: фикстура передаёт `versionsToken(...)`, проверки обновить; отдельный кейс с `FEATURE_LEGAL=0` (легаси) |
| `tests/integration/checkout-orders.test.ts` | новые пользователи без `email_verified_at` → `email_unverified`; согласия — с хэшем и другой версией; `createOrder` ждёт `consents` | 3A: в фикстурах `email_verified_at`, подготовленные согласия; кейс с `FEATURE_LEGAL=0` |
| `tests/integration/checkout-concurrency.test.ts` (Postgres) | то же | 3A |
| `tests/unit/checkout-validation.test.ts` | `parseCheckout(raw, { legal })` и поля `consentOffer`, `consentPd` | 3A |
| `tests/e2e/checkout.spec.ts` | подпись галочки регистрации (`/Согласен\(на\) на сбор и обработку/` → «Даю согласие…»); две галочки на покупке и другой текст ошибки; после регистрации форма покупки закрыта до подтверждения email | 3A: метки по новым текстам; шаг «`openLatestMailLink` → „Подтвердить email“ → снова форма покупки»; ошибки обеих галочек |
| `tests/integration/team-assign.test.ts` | `assignCourse` при активном `REMINDERS` ставит письма `assignment_new` (журнал не меняется, но в БД новые строки) | 4A: проверить счётчики, добавить кейс письма и повтора |
| `tests/integration/admin-users.test.ts` | карточка пользователя получает согласия и действие ссылки | 4A (дополнить; ломаться не должен) |
| `tests/integration/admin-lessons.test.ts` | `updateLesson` теперь проверяет ссылки на файлы; контент без файлов не меняется | 3B (прогон, при падении — фикстура) |
| `tests/e2e/smoke.spec.ts` | не ломается; дополняется ссылкой «Забыли пароль?» | 2A |

Почему e2e не переводятся на выключенные флаги: в демо флаги включены, именно это видит
владелец на превью. Каждая задача, которая меняет поведение по своему флагу, сама чинит e2e,
которые это задевает. E2E покупки задевают две функции, поэтому они в одной задаче 3A.

---

## 7. Что не делаем сейчас (ждёт владельца или отдельной задачи)

- SMTP-адаптер и зависимость (`nodemailer` или клиент HTTP API) — после выбора провайдера (вопрос 2).
  Тогда же: `MAIL_TRANSPORT=smtp`, `SMTP_*`, DNS (SPF, DKIM, DMARC), письма «доступ открыт» и счёт.
- Провайдер `s3` для файлов, антивирус ClamAV, PPTX, просмотр PDF в браузере.
- WAL-архив и восстановление на момент времени; доставка алертов (Telegram); внешний uptime-монитор.
- Включение флагов на проде — после приёмки каждой функции владельцем. `LEGAL` — после
  утверждения текстов юристом.
- Экран организаций и сотрудников в админке (без него «Команда» и напоминания на проде пустые) —
  **завести issue** в зону admin. `create-admin --invite` — после почты.
- Повторное согласие при новой редакции, отзыв согласия в интерфейсе, согласие на
  трансграничную передачу, редактор документов в админке.
- Регистрация «сначала email»; смена email и пароля из профиля; создание аккаунтов админом
  (D-011 — предложено).
- Практические задания слушателей (#21), видео (D-008), nonce-CSP, blue/green, деплой из CI,
  HSTS `includeSubDomains`, массовая выгрузка PDF.

---

## 8. Вопросы владельцу (по важности)

1. **Сервер в РК и домен.** Где размещаем прод, чей аккаунт и кто платит?
   *Рекомендую:* VPS в дата-центре РК по договору ЦРП (ЦРП — оператор ПДн): 2 vCPU, 4 ГБ RAM,
   60 ГБ SSD, Ubuntu 24.04. Кандидаты: PS Cloud Services, Hoster.kz, QazCloud — сравнить цену и SLA.
   Домен `learn.crp.kz`, A-запись делает человек ЦРП с доступом к DNS.
2. **Почта.** Через кого отправлять письма и с какого адреса?
   *Рекомендую:* SMTP провайдера с серверами в РК (почта хостинга ЦРП), тогда нет трансграничной
   передачи. Отправитель `noreply@<домен ЦРП>`, ответы — на рабочий ящик ЦРП. Нужен доступ к DNS
   для SPF, DKIM, DMARC. Зарубежные сервисы (Resend и др.) — только с решением ЦРП и согласием.
   Без почты сброс пароля, подтверждение email и напоминания на проде не включатся.
3. **Юридические тексты.** Кто пишет и утверждает оферту, политику, согласие и условия возврата
   на ru и kz?
   *Рекомендую:* готовит юрист ЦРП, утверждает директор. `LEGAL` на проде — только после
   утверждения обеих языковых версий. В согласие включить публичную проверку сертификата (ФИО,
   курс, дата) и то, что руководитель видит прогресс сотрудника. Юристу заодно: нужна ли
   лицензия или уведомление для платных онлайн-курсов ТОО.
4. **Покупка.** Две галочки (оферта отдельно от согласия на ПДн)? Подтверждение email
   обязательно для заказа?
   *Рекомендую:* да и да. Счёт и доступ уходят на проверенный адрес, захват чужого email не
   даёт заказа (#25). Цена — один лишний шаг для нового покупателя.
5. **Бэкапы.** Где вторая копия, кто хранит ключи расшифровки, устраивает ли потеря до 24 часов?
   *Рекомендую:* вторая копия — у другого провайдера в РК; два хранителя ключа (ЦРП и SalemAI),
   ключи офлайн; RPO 24 часа до эквайринга, оплаты за сутки восстанавливаются по выписке.
6. **Доступы и стейдж.** Кто имеет SSH и право выкладки, кто ставит теги релизов? Нужен ли стейдж?
   *Рекомендую:* 2 человека SalemAI и 1 от ИТ ЦРП, у каждого своя учётка и ключ, список вне
   репозитория. Стейдж — второй экземпляр на том же сервере (своя БД, поддомен под паролем,
   только синтетические данные).
7. **Алерты.** Куда приходят сообщения о сбоях? Подключать внешний uptime-монитор?
   *Рекомендую:* Telegram-бот в закрытый чат эксплуатации, тексты без ПДн. Внешний монитор
   (например, UptimeRobot) — да: он видит только `/api/health`.
8. **Файлы.** Кто загружает, какие лимиты и форматы, нужен ли антивирус?
   *Рекомендую:* в MVP загружает только администратор; изображение до 5 МБ, документ до 25 МБ;
   квота 20 ГБ всего и 2 ГБ на курс (сверить с диском); добавить PPTX; старые DOC/XLS не
   принимать; ClamAV на сервере — до заданий слушателей (#21) обязательно.
9. **Сертификат.** Кто подписант (ФИО, должность)? Нужны ли факсимиле и печать?
   *Рекомендую:* должность и ФИО текстом, без факсимиле и печати: изображение подписи в
   общедоступном PDF легко скопировать. Название «Сертификат», без слов о государственном
   образце; формулировку подтвердить юристу.
10. **Напоминания и письма.** Как часто сводка руководителю, сколько хранить письма?
    *Рекомендую:* сводка раз в неделю, в понедельник в 9:00, только если есть просрочки или
    близкие сроки; сотрудникам — «осталось 3 дня» и «срок прошёл» по одному разу на срок, с 9 до
    19 по Астане; письма хранить 90 дней; в письме «Пароль изменён» — телефон со страницы входа.
11. **Процессы по ПДн.** Как отзывать согласие, когда просить повторное, что хранить как доказательство?
    *Рекомендую:* отзыв — письмом на email ЦРП, админ отмечает и закрывает аккаунт; повторное
    согласие — при следующей покупке (экран при входе — только если меняются цели или состав
    данных); хранить аккаунт, время, версию и хэш текста, без IP; пользователи 18+.
12. **Сотрудники ЦРП на проде.** Как заводим организацию ЦРП и сотрудников до экрана управления?
    *Рекомендую:* первый админ и организация — `npm run admin:create`; экран «Организации и
    сотрудники» в админке — следующая задача после этого плана (без него «Команда» и напоминания
    на проде пустые). Список сотрудников с ролями даёт ЦРП (связано с D-011).
