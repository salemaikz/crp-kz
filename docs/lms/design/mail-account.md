# Проект «mail-account»: почтовый слой, сброс пароля, подтверждение email, напоминания

> Проект до реализации. После реализации источник истины — код и docs/lms/BUILD.md; решения — DECISIONS.md. Статусы решений — только в DECISIONS.md.

Статус: проект архитектора (T2), 2026-10-19. Issues: #4 (сброс пароля), #25 (подтверждение
email, покупка гостем), #9 (письма о сроках). Код не меняется этим документом.

Опирается на: AGENTS.md, docs/lms/BUILD.md (§2, §3, §5, §6, §8, §10, §12), SPEC §3, §6,
D-009, D-012, D-015…D-023. Прочитан код: `src/lib/auth/*`, `src/lib/env.ts`, `src/lib/db/*`,
`migrations/*`, `src/lib/team/{assign,report,types,dates}.ts`, `src/lib/orders/{create,admin,types}.ts`,
`src/app/[locale]/{login,register,admin}`, `tests/integration/fixtures/auth-actions.flow.ts`,
`tests/e2e/checkout.spec.ts`.

---

## 1. Цель и границы

### Цель
1. **Почтовый слой** `src/lib/mail/`: очередь писем в БД (outbox), шаблоны ru/kz, отправка
   скриптом по крону, повторы. По умолчанию письма **не уходят наружу** (транспорт `outbox`):
   они сохраняются, админ видит их на странице «Письма». Внешний транспорт (`smtp`)
   подключается конфигом после решения владельца по D-009.
2. **Сброс пароля** (#4, флаг `PASSWORD_RESET`): запрос по email → письмо со ссылкой →
   новый пароль → все сессии аккаунта закрыты.
3. **Подтверждение email** (#25, флаг `EMAIL_VERIFY`): письмо после регистрации, повторная
   отправка, заказ — только с подтверждённого email (предложено, ждёт владельца, D-032). Покупка гостем = регистрация +
   подтверждение (уточнение D-020, см. D-032).
4. **Напоминания о сроках** (#9, флаг `REMINDERS`): «назначен курс», «скоро срок»,
   «срок прошёл», сводка руководителю. Каждое письмо уходит один раз. Запуск —
   `scripts/send-reminders.ts` по крону на сервере, в демо — кнопка в админке.

### Входит
- Миграция `auth_tokens` + `mail_outbox`.
- `src/lib/features.ts` (общий модуль флагов, если ещё не создан другим проектом — контракт в §3.1).
- Страницы `/[locale]/password/forgot`, `/[locale]/password/reset`, `/[locale]/account/verify`,
  `/[locale]/admin/mail`, `/[locale]/admin/mail/[id]`.
- Плашка «Подтвердите email» для вошедших с неподтверждённым email.
- Отказ в заказе без подтверждённого email (`OrderError('email_unverified')`) и панель на форме покупки.
- Кнопка админа «Отправить ссылку для смены пароля» на карточке пользователя.
- Скрипты `scripts/mail-worker.ts`, `scripts/send-reminders.ts`.

### Не входит
- SMTP-адаптер и зависимость `nodemailer` — отдельная задача после решения владельца
  (обоснование в §3.4). Сейчас — интерфейс транспорта и полностью проверенная очередь.
- Письмо «доступ открыт» после оплаты (SPEC §3.4) и письмо со счётом — follow-up зоны checkout:
  слой готов, нужен только шаблон и вызов `enqueueMail` в `markPaid`.
- Смена пароля из профиля, смена email, профиль — нет такого экрана.
- Создание аккаунтов админом и приглашения (D-011 ещё «предложено»). Кнопка «ссылка для
  смены пароля» покрывает выдачу доступа сотрудникам из сида.
- Устранение перечисления через ошибку регистрации `exists` — остаточный риск (§5, п. 2).
- Онбординг-треки из #9 — отдельная задача команды.

### Решения владельца, которые остаются (подробно — §9)
Почтовый провайдер и трансграничная передача (D-009), адрес отправителя и DNS домена,
частота сводки руководителю, обязательность подтверждения email для заказа, срок хранения писем.

---

## 2. Модель данных

Файл: `migrations/2026-10-19-mail-tokens.sql`. Таблицы ссылаются только на `users`, порядок
относительно других миграций не важен. Идемпотентно, только добавляет. Учёт — `schema_migrations` (D-012).

```sql
-- Почта и одноразовые ссылки: токены сброса пароля и подтверждения email, очередь писем.
-- Нормативно: docs/lms/BUILD.md §3, §5; DECISIONS (почтовый слой, токены). Идемпотентно, только добавляет.
-- id — TEXT (UUID), время — BIGINT epoch-мс.

-- Одноразовые токены ссылок. Храним только SHA-256 (hex) от случайных 32 байт; сырой токен
-- живёт в письме (и в mail_outbox.secret до отправки или истечения).
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CONSTRAINT auth_tokens_kind_check
                CHECK (kind IN ('password_reset', 'email_verify')),
  token_hash  TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email       TEXT NOT NULL,               -- email аккаунта при выдаче: сменился — ссылка недействительна
  expires_at  BIGINT NOT NULL,
  used_at     BIGINT,                      -- использован или погашен более новым запросом
  created_at  BIGINT NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_kind_idx ON auth_tokens (user_id, kind) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_tokens_expires_idx ON auth_tokens (expires_at);

-- Очередь писем (outbox). Письмо хранит шаблон и параметры, текст собирается при показе и отправке.
-- status: held — сохранено без отправки (транспорт outbox: демо или почта не подключена);
--         queued → sending → sent | failed; cancelled — ссылка истекла или погашена до отправки.
CREATE TABLE IF NOT EXISTS mail_outbox (
  id                TEXT PRIMARY KEY,
  category          TEXT NOT NULL CHECK (category IN ('auth', 'notice')),
  template          TEXT NOT NULL CHECK (template ~ '^[a-z][a-z0-9_]{1,40}$'),
  locale            TEXT NOT NULL CHECK (locale IN ('ru', 'kz')),
  user_id           TEXT REFERENCES users (id) ON DELETE CASCADE,  -- удалили аккаунт — удалили его письма
  to_email          TEXT NOT NULL CHECK (length(to_email) BETWEEN 3 AND 254),
  params            JSONB NOT NULL DEFAULT '{}'::jsonb,             -- без секретов
  secret            TEXT,                                           -- сырой токен ссылки; NULL после отправки или истечения
  secret_expires_at BIGINT,
  dedupe_key        TEXT UNIQUE,                                    -- идемпотентность напоминаний; NULL — без проверки
  status            TEXT NOT NULL CHECK (status IN ('held', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts          INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at   BIGINT,
  locked_until      BIGINT,                                         -- аренда воркера: истекла — письмо снова берётся
  last_error        TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  provider_id       TEXT,                                           -- Message-ID от транспорта
  sent_at           BIGINT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  CHECK ((secret IS NULL) = (secret_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS mail_outbox_due_idx ON mail_outbox (status, next_attempt_at)
  WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS mail_outbox_recipient_idx ON mail_outbox (to_email, created_at);
CREATE INDEX IF NOT EXISTS mail_outbox_created_idx ON mail_outbox (created_at);
CREATE INDEX IF NOT EXISTS mail_outbox_user_idx ON mail_outbox (user_id);
```

Пояснения:
- `users.email_verified_at` уже есть (BUILD §3), новых колонок в `users` нет.
- `template` без перечня в CHECK: шаблонов будет больше, а менять CHECK — правка ограничения.
  Список шаблонов проверяется в коде (`MAIL_TEMPLATES`). `kind` в `auth_tokens` — с именованным
  CHECK: если понадобится новый вид, миграция в DO-блоке делает `DROP CONSTRAINT IF EXISTS
  auth_tokens_kind_check` и добавляет расширенный.
- `dedupe_key UNIQUE` допускает много NULL. Вставка — `ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`.
- Срок хранения писем — 90 дней (`MAIL_RETENTION_DAYS`, не меньше 31: защиту от повторных
  напоминаний держит `dedupe_key` письма, окно «срок прошёл» — 30 дней), токенов — 7 дней после истечения.
  Чистит воркер (§3.5). Данные в письмах — ПДн (имя, email, курсы), храним минимум.
- Окна напоминаний (§3.7) ограничены во времени. Поэтому удаление старых писем вместе с
  `dedupe_key` не приводит к повторной отправке.

BUILD.md §3 дополняется этими двумя таблицами (делает оркестратор, §8 шаг 0).

---

## 3. Модули и файлы

### 3.1 Флаги — `src/lib/features.ts` (общий для всех проектов)

```ts
export type FeatureName = 'PASSWORD_RESET' | 'EMAIL_VERIFY' | 'REMINDERS' | 'UPLOADS' | 'LEGAL' | 'CERT_PDF';
/** env FEATURE_<NAME>: '1' — вкл, '0' — выкл; не задан — включено в демо (isDemo()), выключено иначе. */
export function isFeatureEnabled(name: FeatureName, env: NodeJS.ProcessEnv = process.env): boolean;
```
Если модуль уже создан другим проектом, используем его как есть.

**Почтовые функции дополнительно требуют готовой почты** — `src/lib/mail/config.ts`:
```ts
export type MailFeature = 'PASSWORD_RESET' | 'EMAIL_VERIFY' | 'REMINDERS';
/** Флаг включён И (демо ИЛИ (транспорт не outbox И задан NEXT_PUBLIC_SITE_URL)). */
export function mailFeature(name: MailFeature): boolean;
```
Без этого правила `EMAIL_VERIFY` в проде без почты заблокировал бы все заказы, а сброс пароля
обещал бы письмо, которое не уйдёт. Ссылки в письмах строятся только из `siteUrl()`, а без
`NEXT_PUBLIC_SITE_URL` он в проде вернул бы `localhost`.

Как флаг гасит функцию:

| Флаг выключен | Страницы | Кнопки и ссылки | Server actions / функции |
|---|---|---|---|
| `PASSWORD_RESET` | `/password/forgot`, `/password/reset` → `notFound()` | «Забыли пароль?» на входе и «Отправить ссылку для смены пароля» у админа не рисуются | `requestPasswordResetAction`, `resetPasswordAction`, `sendResetLinkAction` → `{ error: 'unavailable' }`, в БД ничего не пишется |
| `EMAIL_VERIFY` | `/account/verify` → `notFound()` | плашки «Подтвердите email» нет; форма покупки — как сейчас | регистрация не создаёт токен и письмо; `resendVerificationAction`, `verifyEmailAction` → `unavailable`; `createOrder` не требует подтверждения |
| `REMINDERS` | — | кнопки «Сформировать напоминания» нет | `planReminders` → `{ disabled: true }`, скрипт пишет «выключено» и выходит с кодом 0; `assignCourse` не ставит письмо «назначен курс»; `runRemindersAction` → `unavailable` |
| все три | `/admin/mail`, `/admin/mail/[id]` → `notFound()` | пункт «Письма» в меню админки скрыт | — |

### 3.2 Токены — `src/lib/auth/tokens.ts` (новый, зона foundation)

```ts
export type TokenKind = 'password_reset' | 'email_verify';
export const TOKEN_TTL_MS: Record<TokenKind, number> = {
  password_reset: 60 * 60_000,        // 1 час
  email_verify: 72 * 60 * 60_000,     // 3 дня
};
/** 32 случайных байта → base64url (43 знака); хеш — SHA-256 hex. */
export function generateToken(): { raw: string; hash: string };
export function hashToken(raw: string): string;
export function isTokenShape(raw: unknown): raw is string;   // /^[A-Za-z0-9_-]{43}$/
/**
 * Выдать токен (реализовано в волне 1, порядок уточнён ревью). Вызывать в транзакции с enqueueMail.
 * Порядок: SELECT … FROM users FOR UPDATE (выдачи одного пользователя идут по очереди) →
 * проверка лимитов писем (checkAuthMailCaps) → гашение неиспользованных токенов этого вида и
 * снятие их писем (secret = NULL, held/queued → cancelled) → вставка нового. В токен пишется email из users.
 * null — сработал лимит (recipient_cap или global_cap): ничего не изменено, прежняя ссылка жива;
 * вызывающий ничего не отправляет и отвечает так же, как при успехе (без перечисления аккаунтов).
 * Если после успешного issueToken enqueueMail вернул queued: false — транзакцию откатить.
 */
export async function issueToken(sql: Sql, input: { userId: string; email: string; kind: TokenKind; nowMs?: number })
  : Promise<{ raw: string; expiresAt: number } | null>;
/**
 * Атомарно израсходовать токен. Задача 2A: блокировки — в том же порядке, что у issueToken (users,
 * затем auth_tokens), иначе возможна взаимоблокировка. В коде волны 1 порядок пока обратный: сначала строка пользователя по token_hash
 * FOR UPDATE, затем UPDATE auth_tokens … WHERE used_at IS NULL AND expires_at > $now RETURNING;
 * email аккаунта не совпал с email токена → null.
 */
export async function consumeToken(sql: Sql, raw: string, kind: TokenKind, nowMs?: number)
  : Promise<{ userId: string; email: string } | null>;
```
Хеш — SHA-256 без соли: у токена 256 бит энтропии, медленный хеш не нужен. Поиск — по UNIQUE `token_hash`.

### 3.3 Сброс пароля и подтверждение email (зона foundation)

**`src/lib/auth/recovery.ts`** — логика без Next (тестируется напрямую):
```ts
/** Письмо со ссылкой, если аккаунт есть. Нет аккаунта, демо-аккаунт сида в демо, исчерпан лимит
 *  получателя — молча ничего. Результат вызывающему не раскрывается. */
export async function requestPasswordReset(input: { email: string; locale: Locale; actorId?: string; nowMs?: number })
  : Promise<void>;
/** Новый пароль по токену: пароль, email_verified_at = COALESCE(…, now), DELETE sessions пользователя,
 *  гасит прочие password_reset-токены, audit, письмо password_changed. Одна транзакция.
 *  bcrypt считается ДО транзакции. */
export async function resetPassword(input: { token: string; passwordHash: string; nowMs?: number })
  : Promise<{ ok: true; userId: string } | { ok: false; reason: 'invalid_token' }>;
export async function sendVerification(sql: Sql, input: { userId: string; email: string; name: string; locale: Locale; next?: string | null; nowMs?: number })
  : Promise<EnqueueResult>;
export async function verifyEmail(input: { token: string; nowMs?: number })
  : Promise<{ ok: true; userId: string } | { ok: false; reason: 'invalid_token' }>;
```

**`src/lib/auth/recoveryActions.ts`** (`'use server'`):
```ts
export type RecoveryState =
  | { status: 'sent'; email: string }
  | { status: 'done'; next?: string; loggedIn?: boolean }
  | { status: 'error'; error: 'validation' | 'rate_limited' | 'invalid_token' | 'weak_password' | 'unavailable' }
  | undefined;
export async function requestPasswordResetAction(prev: RecoveryState, fd: FormData): Promise<RecoveryState>;
export async function resetPasswordAction(prev: RecoveryState, fd: FormData): Promise<RecoveryState>;
export async function verifyEmailAction(prev: RecoveryState, fd: FormData): Promise<RecoveryState>;
export async function resendVerificationAction(prev: RecoveryState, fd: FormData): Promise<RecoveryState>;
```
- `requestPasswordResetAction`: флаг → zod email → лимиты → `requestPasswordReset` → всегда
  `{ status: 'sent', email }`. Ошибка формы — только по формату email.
- `resetPasswordAction`: флаг → лимит → `isTokenShape` → `passwordProblem` → `hashPassword` →
  `resetPassword` → при успехе `startSession(userId)` (вход на этом устройстве) →
  `{ status: 'done' }`. Страница показывает «Пароль изменён» и кнопку «Перейти к обучению».
- `verifyEmailAction`: флаг → лимит → `verifyEmail` → `loggedIn = currentUser?.id === userId`;
  `next` берётся из формы через `safeNext`. Если пользователь вошёл и `next` есть, клиент делает
  `router.replace(next)`. Иначе — «Email подтверждён. Войдите, чтобы продолжить» со ссылкой
  `/login?next=`. **Подтверждение не выполняет вход**: ссылка подтверждения не становится ссылкой для входа.
- `resendVerificationAction`: `requireUser` → флаг → уже подтверждён — `done` → лимит →
  `sendVerification` → `sent`.

**Изменения в существующих файлах (foundation):**
- `src/lib/auth/actions.ts` `registerAction`: если `mailFeature('EMAIL_VERIFY')`, в той же
  транзакции после INSERT вызывается `sendVerification(sql, { …, next: safeNext(next) })`. Ответы
  формы не меняются, вход сразу, редирект на `next` как сейчас.
- `src/lib/auth/session.ts`, `index.ts`: `User` и `SessionUserRow` получают
  `emailVerified: boolean` (из `u.email_verified_at IS NOT NULL` в том же SELECT). Тесты, которые
  сравнивают объект пользователя целиком, обновить.
- `src/lib/auth/rateLimit.ts`: ключи в `AUTH_LIMITS` (§5, таблица лимитов).
- `src/app/[locale]/login/page.tsx` и `LoginForm.tsx`: ссылка «Забыли пароль?» под полем
  пароля, если `mailFeature('PASSWORD_RESET')` (флаг передаётся из page в проп).
- `src/app/[locale]/layout.tsx`: под шапкой `<VerifyEmailNotice />` (серверный компонент
  вернёт `null`, если флаг выключен, гость или email уже подтверждён).

**Новые страницы (foundation):**
- `src/app/[locale]/password/forgot/page.tsx` + `ForgotForm.tsx` (client).
- `src/app/[locale]/password/reset/page.tsx` + `ResetForm.tsx` (client): токен читается из
  `location.hash` (`#token=…`), сразу же убирается из адреса (`history.replaceState`) и кладётся в
  скрытое поле. Нет токена — текст «Ссылка неполная» и ссылка на `/password/forgot`.
- `src/app/[locale]/account/verify/page.tsx` + `VerifyEmail.tsx` (client): так же читает
  `#token=…&next=…`, показывает кнопку «Подтвердить email» (POST). На GET ничего не тратится:
  сканеры ссылок в почте не расходуют токен.
- Во всех трёх: `export const metadata = { referrer: 'no-referrer', robots: { index: false } }`;
  `AuthShell` — как вход и регистрация.
- `src/components/account/VerifyEmailNotice.tsx` (server) + `ResendVerification.tsx` (client) — плашка
  `Alert tone="info"`: «Подтвердите email {email}: мы отправили письмо со ссылкой. [Отправить ещё раз]».
  Компонент экспортируется и для формы покупки (вариант `variant="checkout"`).

### 3.4 Почтовый слой — `src/lib/mail/` (новая зона «mail»)

```
src/lib/mail/
  types.ts         MAIL_TEMPLATES, MailTemplate, MailCategory, MailStatus, MailParams, EnqueueInput, EnqueueResult, RenderedMail
  config.ts        mailTransportName(), mailFrom(), mailFeature(), MAIL_RETENTION_DAYS, MAIL_AUTH_RECIPIENT_HOURLY, mailAuthHourlyCap()
  outbox.ts        enqueueMail(), cancelSecrets()
  links.ts         mailLink(row) — абсолютные ссылки только из siteUrl()
  render.ts        renderMail(row) → { subject, text, html }; escapeHtml; oneLine (убирает \r\n из темы и имён)
  layout.ts        HTML-обёртка письма (инлайн-стили по BRAND)
  i18n.ts          createTranslator по messages/{ru,kz}/mail.json (прямой импорт JSON, не через NAMESPACES)
  templates.ts     шаблон → { subject, paragraphs, action?: { label, href }, list? }
  transport.ts     interface MailTransport, resolveTransport(): Promise<MailTransport | null>
  worker.ts        deliverPending(), purgeMail(), RETRY_DELAYS_MS
  admin.ts         listMail(), getMailView() — с assertAdmin
  adminActions.ts  'use server': runRemindersAction()
  index.ts
```

**Типы и API:**
```ts
export const MAIL_TEMPLATES = ['password_reset', 'password_changed', 'email_verify',
  'assignment_new', 'due_soon', 'overdue', 'manager_digest'] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];
export const MAIL_CATEGORY: Record<MailTemplate, 'auth' | 'notice'>;   // первые три — auth
export type DigestItem = { name: string; courseTitle: L10nRaw; dueAt: number };
export type MailParams = {
  password_reset:   { name: string };
  password_changed: { name: string; changedAt: number };
  email_verify:     { name: string; next?: string | null };
  assignment_new:   { name: string; courseSlug: string; courseTitle: L10nRaw; dueAt: number | null };
  due_soon:         { name: string; courseSlug: string; courseTitle: L10nRaw; dueAt: number; progress: number };
  overdue:          { name: string; courseSlug: string; courseTitle: L10nRaw; dueAt: number; progress: number };
  manager_digest:   { name: string; orgName: string; orgSlug: string;
                      overdue: DigestItem[]; soon: DigestItem[]; overdueTotal: number; soonTotal: number }; // списки ≤ 20
};
export type EnqueueInput<T extends MailTemplate = MailTemplate> = {
  template: T; locale: Locale; to: string; userId: string | null; params: MailParams[T];
  secret?: { raw: string; expiresAt: number };   // только password_reset, email_verify
  dedupeKey?: string; nowMs?: number;
};
export type EnqueueResult =
  | { queued: true; id: string; status: 'held' | 'queued' }
  | { queued: false; reason: 'duplicate' | 'recipient_cap' | 'global_cap' };
/** Вставка в outbox в транзакции вызывающего. status: транспорт outbox → 'held', иначе 'queued'.
 *  Для category 'auth' — лимит на получателя (5 в час) и общий предохранитель (mailAuthHourlyCap, 300 в час).
 *  Лимиты считаются по mail_outbox и работают на всех экземплярах. dedupeKey — ON CONFLICT DO NOTHING. */
export async function enqueueMail<T extends MailTemplate>(sql: Sql, input: EnqueueInput<T>): Promise<EnqueueResult>;
export function renderMail(row: MailRow): RenderedMail;   // { subject, text, html }
```

**Транспорты:**
```ts
export type MailTransportName = 'outbox' | 'smtp';
/** Демо → всегда 'outbox' (письма из демо никогда не уходят наружу, D-009, D-015).
 *  Иначе env MAIL_TRANSPORT. Сейчас принимается только 'outbox'. Другое значение — предупреждение
 *  в лог и 'outbox', пока SMTP-адаптер не добавлен отдельной задачей. */
export function mailTransportName(): MailTransportName;
export interface MailTransport {
  readonly name: Exclude<MailTransportName, 'outbox'>;
  send(m: { id: string; from: string; replyTo?: string; to: string; subject: string; text: string; html: string })
    : Promise<{ providerId?: string }>;
}
export async function resolveTransport(): Promise<MailTransport | null>;  // null — outbox
```

**Рекомендация по `nodemailer`: сейчас НЕ добавлять.** Делаем интерфейс `MailTransport`, очередь
и воркер, а в тестах — подставной транспорт. Адаптер `transports/smtp.ts` (~50 строк на
`nodemailer`, версия с пином) и его тест (`streamTransport` или локальный SMTP-приёмник)
добавляются одной задачей, когда владелец выберет провайдера. Почему:
- провайдер не выбран (D-009). У сервиса в РК может быть HTTP API, а не SMTP;
- неиспользуемая зависимость в публичном репозитории — лишняя поверхность атаки и шум аудита;
- адаптер без настоящего сервера всё равно не проверить;
- зависимости добавляет только оркестратор (BUILD §1).

Отвергли:
- `nodemailer` сейчас «на будущее» — по причинам выше;
- Resend — зарубежный сервис, нужно решение ЦРП и согласие (D-009);
- транспорт «в консоль» (#4) — сырые токены попадут в логи. Его роль выполняет страница «Письма».

**Конфиг (env, всё вне репозитория):** `MAIL_TRANSPORT` (`outbox`), `MAIL_FROM`, `MAIL_REPLY_TO`,
`MAIL_AUTH_HOURLY_CAP` (300), `MAIL_RETENTION_DAYS` (90), позже `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`. В `.env.example` — имена без значений.

**Шаблоны и вид письма (BRAND, «Без ИИ-шума»):**
- Две части: `text/plain` и HTML. HTML — таблица шириной 600 px на фоне `#F3F4F1`, белая
  карточка с рамкой 1 px `#DCDED8` и радиусом 20, текст `#14161B`, системный шрифт. Одна
  кнопка-«пилюля» `#E31E24` с белым текстом, без тени. Без картинок и пикселей отслеживания:
  логотип — после выбора провайдера (вложение CID), пока название ЦРП текстом.
- Структура: обращение → 1–2 предложения сути → кнопка с буквальным текстом → ссылка текстом
  (на случай, если кнопка не открывается) → подпись «Платформа обучения ЦРП» и строка
  «Письмо отправлено автоматически, отвечать на него не нужно».
- Без восклицаний, стрелок, «не X, а Y». Даты — через `src/lib/format.ts` (`kk` для `Intl`, D-002).
  Названия курсов — `t(courseTitle, locale)`.
- Все параметры экранируются (`escapeHtml`). Из темы и имён удаляются `\r\n`. Ссылки собирает
  только `links.ts` из `siteUrl()`: из `params` в письмо не попадает ни одна ссылка.
  `params.next` проходит через `safeNext`.

Ссылки (`links.ts`):

| Шаблон | Ссылка |
|---|---|
| `password_reset` | `{site}/{locale}/password/reset#token={raw}` |
| `email_verify` | `{site}/{locale}/account/verify#token={raw}` + `&next={encodeURIComponent(next)}` |
| `password_changed` | `{site}/{locale}/password/forgot` |
| `assignment_new`, `due_soon`, `overdue` | `{site}/{locale}/learn/{courseSlug}` |
| `manager_digest` | `{site}/{locale}/team?org={orgSlug}&status=overdue` |

Почему токен во фрагменте (`#`): фрагмент не уходит на сервер, не пишется в логи nginx и не
попадает в Referer. Отвергли `?token=` — он остаётся в логах прокси и истории переходов.

### 3.5 Воркер и скрипты

```ts
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000]; // всего 5 попыток
export async function deliverPending(opts: { transport: MailTransport; nowMs?: number; batch?: number /* 20 */ })
  : Promise<{ sent: number; retried: number; failed: number; cancelled: number }>;
export async function purgeMail(nowMs?: number)
  : Promise<{ letters: number; tokens: number; secrets: number }>;
```
Захват пачки — одной командой (аренда на 5 минут):
```sql
UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1, locked_until = ${t + 300_000}, updated_at = ${t}
WHERE id IN (
  SELECT id FROM mail_outbox
  WHERE (status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ${t}))
     OR (status = 'sending' AND locked_until < ${t})
  ORDER BY created_at LIMIT ${batch}
  FOR UPDATE SKIP LOCKED)
RETURNING *
```
Дальше для каждого письма:
- `secret_expires_at <= now` → `cancelled`, `secret = NULL`. Мёртвые ссылки не отправляем.
- Успех → `sent`, `sent_at`, `provider_id`, `secret = NULL`, `secret_expires_at = NULL`.
- Ошибка → `attempts < 5`: `queued`, `next_attempt_at = now + RETRY_DELAYS_MS[attempts-1]`; иначе
  `failed`, секрет обнуляется, audit `mail.fail` `{ mailId, template }`. `last_error` — первые
  500 знаков, адреса email вырезаются регэкспом.
- Доставка «хотя бы один раз». Если процесс упал между ответом SMTP и UPDATE, после аренды
  письмо уйдёт повторно — допустимо.

`purgeMail`:
- удаляет письма старше `MAIL_RETENTION_DAYS`;
- удаляет токены, истёкшие более 7 дней назад;
- обнуляет `secret` и `secret_expires_at` у писем с истёкшей ссылкой.

**`scripts/mail-worker.ts`** (`npm run mail:send`): `openDriver()` → `setDb(handle)` →
`migrate` → `purgeMail` → `resolveTransport()`. При `null` пишет «Транспорт outbox: письма не
отправляются» и выходит с кодом 0. Иначе — `deliverPending` пачками, пока есть письма (не
дольше 50 с), затем `close()`. Лог — только счётчики и id, без адресов и текстов.

**`scripts/send-reminders.ts`** (`npm run reminders:run`): `openDriver` → `setDb` → `migrate` →
`planReminders({ actorId: null })` → печать счётчиков. Флаг выключен — сообщение и код 0.

Крон на сервере ЦРП (оформляется в #24; путь к env — на сервере, не в репозитории):
```
CRON_TZ=Asia/Almaty
* * * * *      cd <app> && node --env-file=<env> --import tsx scripts/mail-worker.ts     >> <log>/mail.log 2>&1
0 9-19 * * *   cd <app> && node --env-file=<env> --import tsx scripts/send-reminders.ts  >> <log>/reminders.log 2>&1
```
HTTP-роута для крона и `CRON_SECRET` (#9) нет: скрипт сам ходит в БД, наружу ничего не
открыто. Отвергли HTTP-роут с секретом: лишняя открытая точка и секрет в crontab.
Напоминания — с 9 до 19 по Астане: «скоро срок» не приходит ночью.
`tsx` — devDependency, как и у `db:migrate`; установка на проде решается в #24.

### 3.6 Админка — «Письма» (новая папка `src/app/[locale]/admin/mail`, исполнитель зоны mail)

- `src/lib/mail/admin.ts`:
```ts
export type MailListRow = { id: string; createdAt: number; toEmail: string; template: MailTemplate;
  status: MailStatus; attempts: number; sentAt: number | null; locale: Locale };
export async function listMail(actor: Actor, q: { status?: MailStatus | null; template?: MailTemplate | null; page: number })
  : Promise<{ rows: MailListRow[]; total: number }>;   // 50 на страницу, новые сверху
export type MailView = MailListRow & { subject: string; text: string; lastError: string | null;
  /** Только в демо (isDemo()) и только пока ссылка действует. В остальных случаях null. */
  demoLink: string | null };
export async function getMailView(actor: Actor, id: string): Promise<MailView | null>;
```
  Фильтры — значениями, без склейки SQL: `WHERE (${status}::text IS NULL OR status = ${status})`.
- `src/lib/mail/adminActions.ts`: `runRemindersAction(locale)` → `assertAdmin` → флаг →
  `planReminders({ actorId })` → `ActionResult<{ learners: number; digests: number }>`.
- Страница списка: `adminPage(params, '/admin/mail')`; если нет ни одного почтового флага —
  `notFound()`. `AdminPageHead` «Письма» и строка о режиме: демо / почта не подключена / SMTP.
  Фильтр статуса (`Tabs`), таблица (Время, Кому, Письмо, Статус, Попытки), пагинация.
  Кнопка «Сформировать напоминания» (если `REMINDERS`) с результатом в `Alert`.
- Детальная страница: тема, кому, статус, даты, `last_error`, текстовая версия в `<pre>`. Ссылка
  с токеном — только при `demoLink` (демо). В остальных случаях — «Ссылка скрыта: она действует
  как пароль». HTML-версия не встраивается (меньше поверхность XSS).
- `src/components/admin/AdminNav.tsx`: пункт `{ href: '/admin/mail', key: 'mail' }`. Виден, если
  `mailPages` (проп из layout = любой из трёх `mailFeature`).
- Карточка пользователя `admin/users/[id]`: кнопка «Отправить ссылку для смены пароля»
  (`PASSWORD_RESET`). Действие `sendResetLinkAction(locale, userId)` в `src/lib/admin/actions.ts`
  → `assertAdmin` → `requestPasswordReset({ email, locale: user.locale, actorId })` → audit
  `user.password_reset_link`. Ответ — «Письмо поставлено в очередь». В демо ссылка видна в «Письмах».
  **Поправка после волны 2 (делает 4A):** `requestPasswordReset` молчит в нескольких случаях (сид в
  демо, лимит, письмо не встало в очередь) — для публичной формы это защита от перечисления, для
  админа это ложный успех. Поэтому он возвращает результат `{ sent: true } | { sent: false; reason:
  'not_found' | 'demo_seed' | 'rate_limited' | 'unavailable' }`; публичное действие его по-прежнему
  скрывает, а `sendResetLinkAction` пишет журнал и отвечает «поставлено в очередь» только при
  `sent: true`, иначе — понятный админу текст.

### 3.7 Напоминания — `src/lib/reminders/` (зона mail)

```ts
export const SOON_DAYS = 3;                 // как dueStatus: today | soon
export const OVERDUE_WINDOW_MS = 30 * DAY_MS; // «просрочено» шлём, только если срок прошёл не более 30 дней назад
export type LearnerReminder = { kind: 'due_soon' | 'overdue'; row: TeamReportRow; dedupeKey: string };
/** Чистая функция: строки отчёта → напоминания. Только source = 'assignment', статус today | soon → due_soon,
 *  overdue в окне → overdue. dedupeKey = `${kind}:${row.key}:${row.dueAt}`. */
export function selectLearnerReminders(rows: TeamReportRow[], nowMs: number): LearnerReminder[];
/** ISO-неделя по времени Астаны (UTC+5): '2026-W43'. */
export function isoWeekKey(nowMs: number): string;
export async function planReminders(opts: { nowMs?: number; actorId: string | null })
  : Promise<{ disabled: true } | { disabled: false; dueSoon: number; overdue: number; digests: number }>;
/** Письмо «назначен курс» — из assignCourse, в его транзакции. dedupeKey = `assigned:${enrollmentId}:${dueAt ?? 'none'}`. */
export async function queueAssignmentNotices(sql: Sql, input: {
  orgId: string; courseId: string; userIds: string[]; dueAt: number | null; nowMs: number }): Promise<number>;
```

Кто и когда получает:

| Письмо | Кому | Условие | Ключ идемпотентности |
|---|---|---|---|
| `assignment_new` | сотрудник | `assignCourse` выдал или обновил назначение (не `skipped`); флаг `REMINDERS` | `assigned:{enrollmentId}:{dueAt|none}` — повторное назначение с тем же сроком письма не даёт, с новым — даёт, но не больше 3 писем `assignment_new` в сутки на одно назначение (сделано в 4A: частая смена срока не превращается в рассылку) |
| `due_soon` | сотрудник | назначение, не завершено, доступ действует, сотрудник ещё в организации, до срока 0–3 дня по Астане | `due_soon:{enrollmentId}:{dueAt}` |
| `overdue` | сотрудник | то же, срок прошёл не более 30 дней назад | `overdue:{enrollmentId}:{dueAt}` |
| `manager_digest` | каждый `manager` организации | в организации есть строки `overdue` или `today/soon` | `digest:{orgId}:{managerUserId}:{isoWeek}` — раз в неделю, первым запуском недели (понедельник 9:00) |

- Данные — из `buildTeamReport(orgId, nowMs)` по каждой организации. Он уже учитывает
  завершение, отзыв, истечение доступа и членство (JOIN `organization_members`), так что
  изоляция организаций — тот же проверенный код. Локаль и email — `users.locale`, `users.email`.
- `due_soon` не отправляется, если письмо `assigned:{enrollmentId}:{dueAt}` создано меньше 48 ч
  назад: в нём срок уже указан. Это один запрос `dedupe_key = ANY(${keys}) AND created_at > …`.
- Вставка — `enqueueMail(..., { dedupeKey })` с `ON CONFLICT DO NOTHING`. Параллельные запуски
  (крон и кнопка) не дублируют письма. Транзакция — на одну организацию.
- В конце — audit `reminders.run` `{ dueSoon, overdue, digests }`, `actor_id` = админ или NULL (крон).
  Сделано в 4A: ручной запуск админом пишется всегда, прогон крона — только если поставлено хотя
  бы одно письмо (иначе ежечасный крон засорял бы ленту нулями).
- Когда появится внешний транспорт: таймауты соединения и ответа почтового сервера должны быть
  заметно меньше аренды `LEASE_MS` (например, 60 с), иначе зависшая отправка даст дубль письма.
- `src/lib/team/assign.ts` (зона team): после цикла `enroll`, если `mailFeature('REMINDERS')` —
  `await queueAssignmentNotices(sql, { orgId, courseId, userIds: assigned, dueAt, nowMs })`
  внутри той же транзакции.

### 3.8 Заказ только с подтверждённого email (зона checkout)

Обязательное подтверждение email перед заказом — предложено, ждёт владельца (D-032, PLAN §5, 3A). Делать за флагом `EMAIL_VERIFY`.

- `src/lib/orders/types.ts`: `OrderErrorCode` += `'email_unverified'`.
- `src/lib/orders/create.ts`: `CreateOrderOptions.requireVerifiedEmail?: boolean`, по умолчанию
  `mailFeature('EMAIL_VERIFY')` — по умолчанию проверка включена: забытая опция не открывает
  обход. В существующем `SELECT … FOR UPDATE` пользователя добавить `email_verified_at`. Если
  он NULL и требуется подтверждение — `throw new OrderError('email_unverified')` до любых записей.
- `src/app/[locale]/courses/[slug]/buy/page.tsx`: при `mailFeature('EMAIL_VERIFY') && !user.emailVerified`
  вместо формы — `<VerifyEmailNotice variant="checkout" />`: «Заказ можно оформить после
  подтверждения email…» и «Отправить ещё раз». Подтверждение по ссылке возвращает на эту
  страницу: при регистрации с `next=/…/buy` этот `next` уже лежит в ссылке письма.
- `markPaid` не меняется. Заказ создаёт только вошедший владелец (D-020), а после включения флага —
  только подтверждённый. Старые неоплаченные заказы неподтверждённых аккаунтов админ
  подтверждает как раньше.

---

## 4. Сценарии, экраны, ключи локалей

### Сценарии
1. **Забыл пароль.** Вход → «Забыли пароль?» → `/password/forgot`: email → «Если аккаунт с
   адресом … есть, мы отправили на него письмо…» (в демо ещё: «Письмо можно открыть в
   админке, раздел „Письма“»). Письмо → `/password/reset#token=…` → новый пароль →
   «Пароль изменён. Вы вошли в аккаунт» → «Перейти к обучению». На других устройствах аккаунт
   разлогинен, на почту ушло «Пароль изменён». Ссылка повторно или после часа — «Ссылка
   устарела или уже использована. Запросите новую».
2. **Регистрация с подтверждением.** Регистрация → вход сразу (как сейчас) → письмо «Подтвердите
   email» → плашка под шапкой. Бесплатные курсы и назначения работают. Ссылка из письма →
   «Подтвердить email» → «Email подтверждён» → переход на `next` или в «Моё обучение».
3. **Покупка гостем (#25).** Курс → «Войти и купить» → регистрация с `next=…/buy` → форма
   покупки показывает «Заказ можно оформить после подтверждения email» → ссылка из письма →
   форма покупки → заказ на свой аккаунт (D-020).
4. **Чужой email захвачен заранее (#25).** Злоумышленник зарегистрировал `victim@…`. Заказ он
   оформить не может: email не подтверждён. Владелец почты получает отказ «аккаунт уже есть»
   и идёт в «Забыли пароль?». Письмо приходит владельцу почты → новый пароль, email
   подтверждён, сессии злоумышленника закрыты, его пароль больше не работает → владелец оформляет заказ.
5. **Сотрудник.** Руководитель назначил курс → письмо «Вам назначен курс…». За 3 дня — «Срок по
   курсу … — 25 октября». После срока — «Срок по курсу … прошёл». Каждое письмо — один раз на срок.
6. **Руководитель.** По понедельникам — «Сводка по обучению: ЦРП»: числа и до 20 строк
   «Имя — курс — срок» по просроченным и близким срокам, кнопка «Открыть отчёт».
7. **Админ в демо.** «Письма» → список, открыть письмо → видна ссылка (только в демо) →
   «Сформировать напоминания» → «Поставлено в очередь: 3 напоминания сотрудникам, 1 сводка
   руководителю». Повторное нажатие → «Новых напоминаний нет».
8. **Админ в проде, почта подключена.** «Письма»: очередь и история за 90 дней, статусы,
   ошибки. Ссылки скрыты.

### Ключи локалей

Казахские строки помечаются «требует проверки носителем» (#13). Тест паритета ключей ru↔kz
обязан охватить и `mail.json`.

**`messages/{ru,kz}/auth.json`** (foundation):

| Ключ | ru | kz |
|---|---|---|
| `login.forgot` | Забыли пароль? | Құпиясөзді ұмыттыңыз ба? |
| `forgot.metaTitle`, `forgot.title` | Восстановление пароля | Құпиясөзді қалпына келтіру |
| `forgot.lead` | Укажите email аккаунта. Пришлём ссылку для нового пароля, она действует 1 час. | Аккаунттың email-ын көрсетіңіз. Жаңа құпиясөз орнатуға сілтеме жібереміз, ол 1 сағат жарамды. |
| `forgot.submit` | Получить ссылку | Сілтеме алу |
| `forgot.pending` | Отправляем… | Жіберіп жатырмыз… |
| `forgot.sent` | Если аккаунт с адресом {email} есть, мы отправили на него письмо со ссылкой. Если письма нет несколько минут, проверьте папку «Спам». | Егер {email} мекенжайымен аккаунт болса, оған сілтемесі бар хат жібердік. Хат бірнеше минут ішінде келмесе, «Спам» қалтасын тексеріңіз. |
| `forgot.demoSent` | Демо-версия: письма не отправляются. Письмо можно открыть в админке, раздел «Письма». | Демо-нұсқа: хаттар жіберілмейді. Хатты әкімші бөлімінің «Хаттар» бетінен ашуға болады. |
| `forgot.backToLogin` | Вернуться ко входу | Кіруге оралу |
| `reset.metaTitle`, `reset.title` | Новый пароль | Жаңа құпиясөз |
| `reset.lead` | Не короче 8 символов. После смены пароля аккаунт на других устройствах будет закрыт. | Кемінде 8 таңба. Құпиясөз ауысқаннан кейін басқа құрылғылардағы аккаунт жабылады. |
| `reset.submit` | Сохранить пароль | Құпиясөзді сақтау |
| `reset.pending` | Сохраняем… | Сақтап жатырмыз… |
| `reset.done` | Пароль изменён. Вы вошли в аккаунт. | Құпиясөз өзгертілді. Сіз аккаунтқа кірдіңіз. |
| `reset.toLearn` | Перейти к обучению | Оқуға өту |
| `reset.noToken` | Ссылка неполная. Откройте её из письма целиком или запросите новую. | Сілтеме толық емес. Оны хаттан толық ашыңыз немесе жаңасын сұраңыз. |
| `reset.requestNew` | Запросить новую ссылку | Жаңа сілтеме сұрау |
| `verify.metaTitle`, `verify.title` | Подтверждение email | Email-ды растау |
| `verify.lead` | Нажмите кнопку, чтобы подтвердить адрес. | Мекенжайды растау үшін батырманы басыңыз. |
| `verify.submit` | Подтвердить email | Email-ды растау |
| `verify.done` | Email подтверждён. | Email расталды. |
| `verify.doneLogin` | Email подтверждён. Войдите, чтобы продолжить. | Email расталды. Жалғастыру үшін кіріңіз. |
| `verify.continue` | Продолжить | Жалғастыру |
| `verifyNotice.text` | Подтвердите email {email}: мы отправили письмо со ссылкой. | {email} мекенжайын растаңыз: сілтемесі бар хат жібердік. |
| `verifyNotice.checkout` | Заказ можно оформить после подтверждения email. Письмо со ссылкой отправлено на {email}. | Тапсырысты email расталғаннан кейін рәсімдеуге болады. Сілтемесі бар хат {email} мекенжайына жіберілді. |
| `verifyNotice.resend` | Отправить ещё раз | Қайта жіберу |
| `verifyNotice.resent` | Письмо отправлено ещё раз. | Хат қайта жіберілді. |
| `errors.invalid_token` | Ссылка устарела или уже использована. Запросите новую. | Сілтеменің мерзімі өткен немесе ол пайдаланылған. Жаңасын сұраңыз. |
| `errors.unavailable` | Функция сейчас недоступна. | Бұл мүмкіндік қазір қолжетімсіз. |

**`messages/{ru,kz}/mail.json`** (новый, зона mail; не входит в `NAMESPACES` клиента — грузится `src/lib/mail/i18n.ts`):

| Ключ | ru | kz |
|---|---|---|
| `common.greeting` | Здравствуйте, {name}. | Сәлеметсіз бе, {name}. |
| `common.linkHint` | Если кнопка не открывается, скопируйте ссылку в браузер: | Батырма ашылмаса, сілтемені браузерге көшіріңіз: |
| `common.signature` | Платформа обучения ЦРП | ЦРП оқу платформасы |
| `common.auto` | Письмо отправлено автоматически, отвечать на него не нужно. | Хат автоматты түрде жіберілді, оған жауап берудің қажеті жоқ. |
| `password_reset.subject` | Восстановление пароля | Құпиясөзді қалпына келтіру |
| `password_reset.body` | Вы запросили новый пароль для аккаунта на платформе обучения ЦРП. Ссылка действует 1 час. | Сіз ЦРП оқу платформасындағы аккаунтқа жаңа құпиясөз сұрадыңыз. Сілтеме 1 сағат жарамды. |
| `password_reset.action` | Задать новый пароль | Жаңа құпиясөз орнату |
| `password_reset.ignore` | Если вы не запрашивали смену пароля, ничего не делайте: пароль останется прежним. | Құпиясөзді ауыстыруды сұрамаған болсаңыз, ештеңе істемеңіз: құпиясөз өзгермейді. |
| `password_changed.subject` | Пароль изменён | Құпиясөз өзгертілді |
| `password_changed.body` | Пароль от вашего аккаунта изменён {date}. | Аккаунтыңыздың құпиясөзі {date} өзгертілді. |
| `password_changed.notYou` | Если это были не вы, восстановите доступ по ссылке и позвоните нам: {phone}. | Егер бұл сіз болмасаңыз, сілтеме арқылы қолжетімділікті қалпына келтіріп, бізге қоңырау шалыңыз: {phone}. |
| `password_changed.action` | Восстановить доступ | Қолжетімділікті қалпына келтіру |
| `email_verify.subject` | Подтвердите email | Email-ды растаңыз |
| `email_verify.body` | Подтвердите адрес, чтобы оформлять заказы и получать письма о курсах. Ссылка действует 3 дня. | Тапсырыс рәсімдеу және курстар туралы хат алу үшін мекенжайды растаңыз. Сілтеме 3 күн жарамды. |
| `email_verify.action` | Подтвердить email | Email-ды растау |
| `email_verify.ignore` | Если вы не регистрировались на платформе, ничего не делайте. | Платформада тіркелмеген болсаңыз, ештеңе істемеңіз. |
| `assignment_new.subject` | Вам назначен курс «{course}» | Сізге «{course}» курсы тағайындалды |
| `assignment_new.body` | Руководитель назначил вам курс «{course}». | Басшы сізге «{course}» курсын тағайындады. |
| `assignment_new.due` | Срок — {date}. | Мерзімі — {date}. |
| `assignment_new.action` | Начать курс | Курсты бастау |
| `due_soon.subject` | Срок по курсу «{course}» — {date} | «{course}» курсы бойынша мерзім — {date} |
| `due_soon.body` | {days, plural, =0 {Срок — сегодня.} one {До срока остался # день.} few {До срока осталось # дня.} other {До срока осталось # дней.}} Пройдено {progress}%. | {days, plural, =0 {Мерзім — бүгін.} other {Мерзімге дейін # күн қалды.}} {progress}% өтілді. |
| `due_soon.action` | Продолжить курс | Курсты жалғастыру |
| `overdue.subject` | Срок по курсу «{course}» прошёл | «{course}» курсы бойынша мерзім өтті |
| `overdue.body` | Срок был {date}. Пройдено {progress}%. Завершите курс или напишите руководителю. | Мерзім {date} болатын. {progress}% өтілді. Курсты аяқтаңыз немесе басшыға жазыңыз. |
| `overdue.action` | Продолжить курс | Курсты жалғастыру |
| `manager_digest.subject` | Сводка по обучению: {org} | Оқу бойынша жиынтық: {org} |
| `manager_digest.body` | Просрочено: {overdue}. Срок в ближайшие 3 дня: {soon}. | Мерзімі өткен: {overdue}. Алдағы 3 күнде мерзімі: {soon}. |
| `manager_digest.overdueTitle` | Просрочено | Мерзімі өткен |
| `manager_digest.soonTitle` | Срок скоро | Мерзімі жақын |
| `manager_digest.line` | {name} — {course} — {date} | {name} — {course} — {date} |
| `manager_digest.more` | И ещё {count} в отчёте. | Есепте тағы {count}. |
| `manager_digest.action` | Открыть отчёт | Есепті ашу |

(`{phone}` — тот же номер, что в `auth.help`.)

**`messages/{ru,kz}/admin.json`** (зона admin, ключи добавляет исполнитель mail):

| Ключ | ru | kz |
|---|---|---|
| `shell.nav.mail` | Письма | Хаттар |
| `mail.title` | Письма | Хаттар |
| `mail.mode.demo` | Демо-версия: письма не отправляются и хранятся здесь до перезапуска. | Демо-нұсқа: хаттар жіберілмейді, қайта іске қосылғанға дейін осында сақталады. |
| `mail.mode.outbox` | Почта не подключена: письма сохраняются здесь и не отправляются. | Пошта қосылмаған: хаттар осында сақталады және жіберілмейді. |
| `mail.mode.smtp` | Очередь и история писем за 90 дней. | Соңғы 90 күндегі хаттар кезегі мен тарихы. |
| `mail.cols.time` / `to` / `letter` / `status` / `attempts` | Время / Кому / Письмо / Статус / Попытки | Уақыты / Кімге / Хат / Мәртебесі / Әрекеттер |
| `mail.status.held` / `queued` / `sending` / `sent` / `failed` / `cancelled` | Сохранено / В очереди / Отправляется / Отправлено / Ошибка / Отменено | Сақталды / Кезекте / Жіберілуде / Жіберілді / Қате / Тоқтатылды |
| `mail.template.password_reset` … `manager_digest` | Сброс пароля / Пароль изменён / Подтверждение email / Назначен курс / Скоро срок / Срок прошёл / Сводка руководителю | Құпиясөзді қалпына келтіру / Құпиясөз өзгертілді / Email-ды растау / Курс тағайындалды / Мерзімі жақын / Мерзімі өтті / Басшыға жиынтық |
| `mail.empty` | Писем пока нет. | Әзірге хаттар жоқ. |
| `mail.runReminders` | Сформировать напоминания | Еске салғыштарды құру |
| `mail.runResult` | Поставлено в очередь: напоминаний сотрудникам — {learners}, сводок руководителям — {digests}. | Кезекке қойылды: қызметкерлерге еске салғыш — {learners}, басшыларға жиынтық — {digests}. |
| `mail.runNone` | Новых напоминаний нет. | Жаңа еске салғыштар жоқ. |
| `mail.linkHidden` | Ссылка скрыта: она действует как пароль. | Сілтеме жасырылған: ол құпиясөз сияқты әрекет етеді. |
| `mail.demoLink` | Ссылка из письма (видна только в демо) | Хаттағы сілтеме (тек демода көрінеді) |
| `mail.lastError` | Ошибка отправки | Жіберу қатесі |
| `users.sendReset` | Отправить ссылку для смены пароля | Құпиясөзді ауыстыру сілтемесін жіберу |
| `users.sendResetDone` | Письмо поставлено в очередь. | Хат кезекке қойылды. |

**`messages/{ru,kz}/checkout.json`**: `errors.email_unverified` — «Заказ можно оформить после
подтверждения email.» / «Тапсырысты email расталғаннан кейін рәсімдеуге болады.»

---

## 5. Безопасность и угрозы

| # | Угроза | Как закрыто |
|---|---|---|
| 1 | Перечисление пользователей через «Забыли пароль?» | Ответ один и тот же; ошибка — только по формату email; письмо уходит только существующему аккаунту. Разница во времени (INSERT есть или нет) мала, а лимит 3 запроса в час на email делает статистику по времени непрактичной. Отвергли `after()`: на Netlify и других платформах без `waitUntil` работа может оборваться |
| 2 | Перечисление через регистрацию (`exists`) | Уже есть, не меняем. Остаточный риск, follow-up: регистрация «сначала email» (D-032, отвергнутый вариант) |
| 3 | Перебор токена | 256 бит; лимиты на отправку формы; токен с неверной формой отклоняется до запроса в БД |
| 4 | Утечка БД → токены | В `auth_tokens` — только SHA-256. Сырой токен — в `mail_outbox.secret`, пока письмо не отправлено или ссылка не истекла (≤ 1 ч / 3 дня), затем NULL |
| 5 | Утечка через логи и Referer | Токен во фрагменте `#`; страницы `referrer: no-referrer`, `noindex`; токен сразу убирается из адреса; в логах воркера нет адресов и текстов |
| 6 | Повторное использование ссылки | Атомарный `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING` |
| 7 | Старые ссылки после нового запроса | `issueToken` гасит прежние токены этого вида и снимает с отправки их письма; сброс гасит все reset-токены |
| 8 | Чужая сессия после смены пароля | `DELETE FROM sessions WHERE user_id` в транзакции сброса. В демо сессии сид-пользователей восстанавливаются по подписи (BUILD §5), поэтому в демо сброс для сид-пользователей (`isSeedUser`) молча не выполняется |
| 9 | Предзахват email (#25) | Предложено, ждёт владельца (D-032): заказ — только с подтверждённого email (`email_unverified`). Сброс пароля через почту отбирает аккаунт у захватчика и подтверждает email. Заказ по email не ищется (D-020) |
| 10 | Смена email между выдачей и использованием | Email-снимок в токене сверяется с `users.email` под `FOR UPDATE` |
| 11 | Почтовая бомбардировка, репутация домена | Лимиты в памяти (IP, email, пользователь) + лимиты в БД: auth-письма — 5 в час на получателя, предохранитель 300 в час на все auth-письма (письма сверх него не ставятся, `console.error`). Письма «аккаунта нет» не шлём |
| 12 | HTML-инъекция и подмена заголовков | Экранирование всех параметров; `\r\n` вырезаются из темы и имён; ссылки — только из `siteUrl()` и кода |
| 13 | Подмена хоста в ссылках | Ссылки не берутся из заголовка `Host`; в проде почтовые функции требуют `NEXT_PUBLIC_SITE_URL` (§3.1) |
| 14 | Открытый редирект через `next` в письме | `safeNext` при выдаче и при использовании |
| 15 | CSRF | Server actions (POST, проверка Origin в Next); GET ничего не меняет |
| 16 | ПДн за рубеж (D-009) | По умолчанию `outbox`; в демо — всегда `outbox`; `smtp` — только после решения владельца и отдельной задачи |
| 17 | Двойные напоминания | `dedupe_key UNIQUE` + `ON CONFLICT DO NOTHING`; аренда и `SKIP LOCKED` у воркера. Остаточный риск: повтор письма при падении между SMTP и UPDATE |
| 18 | Сводка с чужими сотрудниками | Данные строго `buildTeamReport(orgId)`, получатели — менеджеры этой организации; тест изоляции |
| 19 | Напоминание бывшему сотруднику | Отчёт делает JOIN по текущему членству; отозванный или истёкший доступ исключён |
| 20 | Админ использует чужую ссылку | В проде ссылки в «Письмах» скрыты; видны только в демо |
| 21 | Секреты SMTP в коде или логах | Только env; `last_error` обрезан до 500 знаков, адреса вырезаны |
| 22 | Нагрузка на bcrypt через форму сброса | Лимит на IP; при неизвестном IP — общее ведро, как у входа (D-018) |

**Лимиты (в `AUTH_LIMITS`, память процесса):**

| Ключ | Лимит | Неизвестный IP |
|---|---|---|
| `reset-request-ip:{ip}` | 10 / час | не применяется, общего ведра нет (как D-022) |
| `reset-request-email:{email}` | 3 / час | применяется |
| `reset-submit:{ip}` | 20 / 15 мин | `reset-submit:unknown` 300 / мин (CPU, как `loginUnknownIp`) |
| `verify-submit:{ip}` | 30 / 15 мин | без лимита (bcrypt нет, токен 256 бит) |
| `verify-resend:{userId}` | 3 / час | — |

**Журнал (`audit_log`, без email и токенов в `meta`; имена — по реестру `src/lib/audit.ts`):**
`user.password_reset_request`, `user.password_reset`, `user.password_reset_link`,
`user.email_verify_request`, `user.email_verify`, `reminders.run`, `mail.fail`.

---

## 6. Флаг и демо-поведение

- Флаги — §3.1. В демо (`isDemo()`) все три включены по умолчанию. В production выключены, пока
  нет `FEATURE_*=1`. Даже со включённым флагом функция в production работает только при
  транспорте не `outbox` и заданном `NEXT_PUBLIC_SITE_URL`.
- **Почта в демо:** транспорт всегда `outbox`, даже если задан `MAIL_TRANSPORT`. Письма
  сохраняются со статусом «Сохранено» и видны в «Письмах» (PGlite в памяти, до перезапуска
  экземпляра). Ссылка из письма видна только в демо: реальных ящиков там нет (D-015).
- **Сброс пароля в демо:** для сид-пользователей молча не выполняется (п. 8 угроз). Новые
  аккаунты, созданные в демо, сбрасываются нормально. Ссылку берут из «Писем», войдя как
  администратор (кнопка демо-входа).
- **Подтверждение email в демо:** сид-пользователи подтверждены. Новый аккаунт видит плашку и
  панель на форме покупки, ссылку берёт из «Писем». Поток для владельца: «Войти как
  администратор» в другом окне → «Письма» → письмо → ссылка.
- **Напоминания в демо:** крона нет. Кнопка «Сформировать напоминания» в «Письмах». В сиде уже
  есть сроки: −7, −3 (просрочено), +2 (скоро), +5, +10, +14 — это две «просрочено», одна «скоро»
  и сводка руководителю `manager@crp.demo`. Повторное нажатие — «Новых напоминаний нет».
- Воркер и скрипты в демо не нужны (Vercel/Netlify без крона и диска). Если запустить
  `mail-worker` локально без `DATABASE_URL`, он сообщит «транспорт outbox» и выйдет.
- Снимок демо-базы (BUILD §11) создаётся до новых миграций. Рантайм `migrate()` догонит
  `2026-10-19-mail-tokens.sql` — правки снимка не нужны.

---

## 7. Тесты

### Unit (`tests/unit/`)
- `features.test.ts`: матрица `FEATURE_X=1|0|не задан` × демо/production.
- `mail-config.test.ts`: в демо всегда `outbox`; неизвестный `MAIL_TRANSPORT` → `outbox`;
  `mailFeature` в production при `outbox` или без `NEXT_PUBLIC_SITE_URL` → false.
- `auth-tokens.test.ts`: `generateToken` даёт 43 знака base64url и хеш 64 hex; `hashToken`
  детерминирован; `isTokenShape` отклоняет 42 и 44 знака, `+/=`, не-строку.
- `mail-render.test.ts`: каждый шаблон × ru/kz:
  - тема и текст не пустые, kz ≠ ru;
  - ссылка абсолютная, от `siteUrl()`; токен — после `#`;
  - имя `<script>x</script>` в HTML экранировано, `\r\n` в имени не попадает в тему;
  - нет «→» и «!»;
  - плюрализация `due_soon` (0, 1, 2, 5 дней);
  - даты с `kk` для kz.
- `reminders-select.test.ts`:
  - `selectLearnerReminders`: только `assignment`; today/soon → `due_soon`; overdue ≤ 30 дней →
    `overdue`, 31 день — нет; done, revoked, expired, nodue — нет; ключи;
  - `isoWeekKey`: воскресенье 23:30 и понедельник 00:30 по Астане дают разные недели, граница года.
- `mail-worker-backoff.test.ts`: расписание задержек, 5-я ошибка → `failed`.
- Стиль: добавить `messages/*/mail.json` в проверки `brand-no-ai-slop` (стрелки, восклицания), если тест смотрит сообщения.
- Паритет ключей ru↔kz — включая `mail.json`.

### Integration (`tests/integration/`, PGlite; в CI ещё Postgres 16)
- `core-migrations` (существующий) — новая миграция идемпотентна (двойной прогон).
- `mail-outbox.test.ts`:
  - транспорт `outbox` → `held`;
  - тот же `dedupeKey` → `duplicate`;
  - 6-е auth-письмо получателю за час → `recipient_cap`;
  - предохранитель при `MAIL_AUTH_HOURLY_CAP=3` → `global_cap`;
  - notice-письма лимиты получателя не трогают.
- `mail-worker.test.ts` (подставной транспорт):
  - успех → `sent`, `secret` NULL;
  - ошибка → `queued` с `next_attempt_at`, `attempts=1`; 5 ошибок → `failed` и audit `mail.fail`;
  - истёкшая ссылка → `cancelled`, `send` не вызван;
  - просроченная аренда `sending` подхватывается снова;
  - `purgeMail` удаляет письма старше 90 дней и старые токены, обнуляет истёкшие секреты.
- `mail-worker-concurrency.test.ts` (только Postgres, без `TEST_DATABASE_URL` — skip): два
  `deliverPending` параллельно на 30 писем — каждое отправлено ровно один раз.
- `auth-recovery.test.ts` + `fixtures/auth-recovery.flow.ts` (как `auth-actions.flow.ts`: подмена
  `next/headers`, `next/navigation`, отдельный процесс):
  - forgot: неизвестный email и известный дают одинаковый ответ; для неизвестного строк нет;
  - forgot: 4-й запрос на email за час → `rate_limited`;
  - второй запрос гасит первый токен, письмо первого → `cancelled`;
  - reset: пароль сменён; вторая сессия того же пользователя больше не проходит
    `resolveSessionToken`; новая cookie выдана; токен повторно → `invalid_token`; истёкший
    (`nowMs` + 61 мин) → `invalid_token`;
  - verify-токен в reset → `invalid_token`; слабый пароль → `weak_password`, токен не израсходован;
  - email сменили после выдачи → `invalid_token`;
  - после reset `email_verified_at` заполнен, письмо `password_changed` в очереди, audit;
  - флаг выключен (`FEATURE_PASSWORD_RESET=0`) → `unavailable`, строк нет;
  - демо + сид-пользователь → письма нет.
- `auth-verify.test.ts` (тот же приём):
  - регистрация при флаге → `email_verified_at` NULL, письмо `email_verify` с `next` из формы;
    при `FEATURE_EMAIL_VERIFY=0` письма нет;
  - verify → подтверждён; повторно → `invalid_token`;
  - `loggedIn` true, только если сессия того же пользователя; `next=https://evil` отброшен;
  - resend: 4-й за час → `rate_limited`; уже подтверждён → `done`.
- `checkout-email-verify.test.ts` — **сценарий #25**:
  1. злоумышленник регистрирует `victim@crp.demo` (неподтверждён);
  2. `createOrder` → `email_unverified`, заказов 0;
  3. `requestPasswordReset(victim)` → токен из `mail_outbox.secret` → `resetPassword`;
  4. сессия злоумышленника недействительна, старый пароль не проходит `verifyPassword`;
  5. email подтверждён; `createOrder` под владельцем почты → заказ с `user_id` этого аккаунта;
     `markPaid` → зачисление ему.

  Плюс: при `FEATURE_EMAIL_VERIFY=0` неподтверждённый оформляет заказ как раньше. Существующие
  интеграционные тесты заказов, где создаются новые пользователи, получают
  `email_verified_at` в фикстуре.
- `reminders.test.ts`:
  - сид-подобные данные: просрочено −3 и −7 → 2 `overdue`, +2 → 1 `due_soon`, +5 → ничего;
    завершённый → ничего;
  - повторный `planReminders` → 0 новых;
  - продление срока (`dueAt` новый) → новое письмо;
  - отозван, истёк, вышел из организации → ничего; `self`/`purchase` → ничего;
    просрочено 40 дней → ничего;
  - сводка: одна на менеджера за неделю; через 7 дней — новая; менеджер организации B не
    получает сводку A (изоляция);
  - `assignCourse` при флаге → `assignment_new` назначенным, `skipped` — без письма; повтор с
    тем же сроком → без дубля; `due_soon` в течение 48 ч после него не ставится;
  - флаг выключен → `{ disabled: true }`, писем нет;
  - audit `reminders.run`.
- `reminders-concurrency.test.ts` (только Postgres): два `planReminders` параллельно — каждое письмо один раз.
- `admin-mail.test.ts`:
  - `listMail` и `getMailView` для не-админа → FORBIDDEN;
  - фильтры;
  - `demoLink` есть в демо и null при `DEMO_MODE` выкл + `DATABASE_URL` (подмена env);
  - `runRemindersAction` без флага → `unavailable`.

### E2E (`tests/e2e/`, демо, флаги по умолчанию включены)
- `helpers/mail.ts`: `openLatestMailLink(browser, { to, template })` — отдельный контекст, «Войти
  как администратор», `/ru/admin/mail`, последнее письмо получателю, ссылка из блока демо-ссылки.
- `password-reset.spec.ts`:
  1. регистрация нового `e2e-reset-…@example.kz` → выход;
  2. «Забыли пароль?» → email → текст «Если аккаунт…»;
  3. ссылка через helper → новый пароль → «Пароль изменён» → «Перейти к обучению»;
  4. выход → вход со старым паролем — ошибка, с новым — успех;
  5. та же ссылка повторно → «Ссылка устарела…».
- `checkout.spec.ts` (зона checkout, правка существующих сценариев): после регистрации форма
  покупки показывает «Заказ можно оформить после подтверждения email» → helper → ссылка в
  контексте покупателя → «Подтвердить email» → снова форма покупки → далее как сейчас.
- `reminders.spec.ts`: админ → «Письма» → «Сформировать напоминания» → результат с числами > 0 →
  в списке есть «Срок прошёл» и «Сводка руководителю» → повторное нажатие → «Новых напоминаний нет».
- `smoke.spec.ts`: ссылка «Забыли пароль?» на странице входа.
- Выключенные флаги в e2e не проверяются: один сервер Playwright. Отказ при выключенном флаге
  (404 страниц, `unavailable` действий) покрыт интеграционными тестами.

Команды перед пушем — как в AGENTS.md: `npm run typecheck`, `lint`, `test:unit`,
`test:integration` (PGlite и `TEST_DATABASE_URL`), `build`, `test:e2e`.

---

## 8. План реализации

Зоны не пересекаются. Шаги 2A и 2B идут параллельно двумя исполнителями (Sonnet).

| Шаг | Уровень | Исполнитель | Файлы (зона) | Зависит от |
|---|---|---|---|---|
| **0.1** Записи в DECISIONS (Приложение A), BUILD.md: §3 таблицы, §5 потоки сброса и подтверждения (заменить «Email не подтверждается»), §6 маршруты, §10 тесты, §12 зона «mail» | T2 | оркестратор + reviewer | `DECISIONS.md`, `docs/lms/BUILD.md` — отдельный коммит | — |
| **0.2** `package.json` scripts: `mail:send`, `reminders:run` (без зависимостей) | T0 | mechanic | `package.json` — отдельный коммит | — |
| **0.3** `src/lib/features.ts` + `tests/unit/features.test.ts`, если ещё не создан другим проектом | T1 | builder | `src/lib/features.ts` | — |
| **1** База: миграция; `src/lib/mail/{types,config,outbox,links,render,layout,i18n,templates,transport,index}.ts`; `messages/{ru,kz}/mail.json` (все 7 шаблонов); `src/lib/auth/tokens.ts`; unit-тесты render, config, tokens; `mail-outbox.test.ts` | T2→T1 | builder A | `migrations/2026-10-19-mail-tokens.sql`, `src/lib/mail/*` (кроме worker/admin), `src/lib/auth/tokens.ts`, `messages/*/mail.json` | 0.3 |
| **2A** Сброс и подтверждение: `recovery.ts`, `recoveryActions.ts`, правки `actions.ts` (регистрация), `session.ts`/`index.ts` (`emailVerified`), `rateLimit.ts`; страницы `password/forgot`, `password/reset`, `account/verify`; `LoginForm` (ссылка); `layout.tsx` + `src/components/account/*`; `messages/*/auth.json`; `.env.example`; тесты `auth-recovery`, `auth-verify` + fixtures | T2→T1 | builder A | foundation: `src/lib/auth/*`, `src/app/[locale]/{login,password,account}`, `src/app/[locale]/layout.tsx`, `src/components/account/`, `messages/*/auth.json` | 1 |
| **2B** Воркер и напоминания: `src/lib/mail/{worker,admin,adminActions}.ts`, `src/lib/reminders/*`, `scripts/{mail-worker,send-reminders}.ts`; правка `src/lib/team/assign.ts` (вызов `queueAssignmentNotices`); страницы `admin/mail`, `admin/mail/[id]`; `AdminNav` + проп из `admin/layout.tsx`; `messages/*/admin.json` (`mail.*`, `shell.nav.mail`); тесты worker, reminders, admin-mail, concurrency; `tests/e2e/helpers/mail.ts`, `reminders.spec.ts` | T2→T1 | builder B | `src/lib/mail/{worker,admin,adminActions}.ts`, `src/lib/reminders/`, `scripts/`, `src/lib/team/assign.ts`, `src/app/[locale]/admin/mail/`, `src/components/admin/AdminNav.tsx`, `src/app/[locale]/admin/layout.tsx`, `messages/*/admin.json` | 1 |
| **2B′** Кнопка «Отправить ссылку для смены пароля» на карточке пользователя | T1 | builder B (после 2A: нужен `requestPasswordReset`) | `src/lib/admin/actions.ts`, `src/app/[locale]/admin/users/[id]/page.tsx`, `src/components/admin/UserForms.tsx` | 2A |
| **3** Заказ только с подтверждённого email: `OrderErrorCode`, `createOrder`, форма покупки с `VerifyEmailNotice`, `messages/*/checkout.json`, `checkout-email-verify.test.ts`, фикстуры существующих тестов, правка `tests/e2e/checkout.spec.ts` через helper | T2→T1 | builder (зона checkout) + reviewer Opus | `src/lib/orders/{types,create}.ts`, `src/app/[locale]/courses/[slug]/buy/*`, `messages/*/checkout.json`, `tests/integration/checkout-*`, `tests/e2e/checkout.spec.ts` | 2A, 2B (helper) |
| **4** E2E `password-reset.spec.ts`, smoke-ссылка; полный прогон проверок на PGlite и Postgres | T1 | tester | `tests/e2e/*` | 2A, 2B, 3 |
| **5** Ревью всего изменения (токены, сессии, заказ, ПДн в письмах, флаги) | T2 | reviewer | — | 4 |
| **6** (после решения владельца) SMTP-адаптер: зависимость `nodemailer` (оркестратор), `src/lib/mail/transports/smtp.ts`, приём `'smtp'` в `mailTransportName`, тест с локальным приёмником, раздел о кроне в документе деплоя (#24) | T2→T1 | оркестратор → builder → reviewer | `package.json`, `src/lib/mail/transports/`, `src/lib/mail/config.ts` | §9 вопросы 1–2 |

Конфликты: A и B оба зависят от шага 1. Общих файлов у 2A и 2B нет: `admin/layout.tsx` и
`AdminNav` — только B; `layout.tsx` локали — только A. `messages/*/admin.json` правит только B,
`auth.json` — только A.

---

## 9. Вопросы владельцу

1. **Почтовый провайдер (D-009).** Через кого отправлять письма? В них email, имя, названия
   курсов и сроки.
   *Рекомендация:* SMTP сервиса с серверами в РК (почта хостинга сервера ЦРП или
   казахстанского провайдера). Тогда трансграничной передачи нет и галочка согласия не нужна.
   Resend и другие зарубежные сервисы — только после решения ЦРП, с согласием и проверкой юриста.
2. **Адрес отправителя и домен.** *Рекомендация:* `noreply@<домен ЦРП>`, ответы — на рабочий
   ящик ЦРП (`MAIL_REPLY_TO`). Нужен доступ к DNS для SPF, DKIM и DMARC, иначе письма уйдут в спам.
3. **Подтверждение email обязательно для заказа?** *Рекомендация:* да. Счёт и письма о доступе
   уходят на проверенный адрес, захват чужого email не даёт заказа (#25). Цена — один лишний
   шаг для нового покупателя.
4. **Сводка руководителю: как часто?** *Рекомендация:* раз в неделю, в понедельник в 9:00, и
   только если есть просрочки или близкие сроки. Ежедневная — при большом числе сотрудников.
5. **Напоминания сотрудникам.** *Рекомендация:* «осталось 3 дня» и «срок прошёл» — по одному
   разу на срок, с 9 до 19 по Астане. «Срок прошёл» еженедельно не повторяем, руководитель видит
   просрочку в сводке.
6. **Срок хранения писем в системе.** *Рекомендация:* 90 дней, затем удаление (минимум ПДн).
   Нужно согласовать с политикой обработки ПДн (юрист ЦРП).
7. **Телефон поддержки в письме «Пароль изменён».** *Рекомендация:* тот же номер, что на странице
   входа (`auth.help`).

---

## Приложение A. Записи в DECISIONS.md

Перенесено в `DECISIONS.md`: почта и очередь — D-030, одноразовые ссылки — D-031, покупка гостем и
подтверждение email — D-032, напоминания — D-033. Источник истины — там. Обязательное
подтверждение email перед заказом — предложено, ждёт владельца (D-032).
