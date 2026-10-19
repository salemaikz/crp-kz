# Проект «legal-certpdf»: юридические документы и согласия (#17, `LEGAL`) · PDF сертификата (#11, `CERT_PDF`)

> Проект до реализации. После реализации источник истины — код и docs/lms/BUILD.md; решения — DECISIONS.md.

Автор: architect (T2) · 2026-10-19 · ветка `claude/amazing-pascal-agse3o`.
Документ для исполнителей уровня T1. Код по нему пишет `builder`, проверяет `reviewer`.

Опора:
- `AGENTS.md`;
- `docs/lms/BUILD.md` §1–3, 5, 6, 8, 10–12;
- `docs/lms/SPEC.md` §3 (юридические документы), §5 (сертификаты), §8;
- D-002, D-009, D-012, D-015, D-016, D-018, D-019, D-022, D-023, D-024;
- `docs/brand/BRAND.md`: «Сертификат», «Без ИИ-шума», «Тон».

Что уже есть в коде (проверено):
- **Согласия.** Таблица `consents(id, user_id, order_id, kind, version, created_at)`.
- **Регистрация** (`src/lib/auth/actions.ts`). Пишет `pd_processing` с версией-константой
  `PD_CONSENT_VERSION = '2026-10-19'`. Галочка `consent` — простой текст без ссылок
  (`messages/*/auth.json` → `register.consent`).
- **Заказ** (`src/lib/orders/create.ts`). Пишет `offer` и `pd_processing` с `CONSENT_VERSION`
  из `src/lib/orders/types.ts`. Галочка в форме одна, `consent`
  (`src/lib/orders/validation.ts`, `CheckoutForm.tsx`).
- **Сид** (`src/lib/db/seed/activity.ts`) пишет согласия со своей копией константы.
- Ни текстов документов, ни страниц, ни хэша текста нет. Версии — три разбросанные константы.
- **Сертификат:**
  - `CertificateSheet.tsx` — HTML-лист A4 на `cqw`;
  - `PrintButton` — `window.print()`;
  - `qr.ts` — SVG строкой, пакет `qrcode`;
  - `certificates.ts` — выдача, поиск;
  - `learn/[slug]/certificate/page.tsx` показывает сертификат по `(session user, course)` даже
    при истёкшем доступе. Так и должно быть: по SPEC §2 сертификаты сохраняются.
- `@react-pdf/renderer` в `package.json` **нет**. В списке Next 16
  `node_modules/next/dist/lib/server-external-packages.jsonc` он **есть**: webpack его не
  бандлит, пакет грузится из `node_modules` на сервере.
- Шрифты Geologica и Onest в google/fonts — **только вариативные** TTF:
  - `Geologica[CRSV,SHRP,slnt,wght].ttf`, OFL, без Reserved Font Name;
  - `Onest[wght].ttf`, OFL.

---

## 1. Цель и границы

### 1.1 Юридические документы (#17, флаг `LEGAL`)

**Входит:**
- Четыре документа на `ru` и `kz`:
  - публичная оферта (`offer`);
  - политика обработки ПДн (`privacy`);
  - согласие на сбор и обработку ПДн (`pd_consent`);
  - условия возврата (`refund`).
- Тексты — **заглушки-черновики** с пометкой «Черновик. Текст готовит и утверждает юрист ЦРП».
  В них структура разделов и места `[заполняет юрист ЦРП]`. Реквизитов, сумм, сроков и
  формулировок обязательств не выдумываем.
- Версии документов:
  - реестр версий в коде;
  - тексты — файлами в репозитории;
  - SHA-256 нормализованного текста закреплён в реестре и проверяется тестом;
  - копия принятого текста кладётся в БД (`legal_texts`, адресация по хэшу) в момент первого
    согласия с ним.
- Согласие фиксируется с видом, версией, языком, контекстом (`register` | `checkout`) и хэшем
  текста. Так делают:
  - регистрация (`pd_processing`);
  - оформление заказа (`offer` и `pd_processing` — **две отдельные галочки**, см. вопрос В-2).
- Защита от «подмены версии под ногами». Форма отправляет токен версий, которые видел человек.
  Если с тех пор вышла новая редакция, сервер просит отметить согласие ещё раз. Сервер не
  выбирает текст по токену из формы, только сравнивает.
- Страницы:
  - `/[locale]/legal` — список;
  - `/[locale]/legal/[doc]` — действующая редакция;
  - `/[locale]/legal/[doc]/[version]` — архивная редакция.
- Ссылки на документы — в подвале и в подписях галочек (открываются в новой вкладке).
- Админу — список согласий в карточке пользователя (шаг A4, можно отдельным PR).

**Не входит:**
- редактор документов в админке;
- экран повторного согласия при входе;
- отзыв согласия через интерфейс (колонку `withdrawn_at` закладываем, процесс — вопрос В-6);
- согласие на трансграничную передачу: вид `cross_border` резервируем в CHECK, но UI и текст
  появятся, только когда ЦРП выберет зарубежного провайдера (D-009, проект mail);
- печать оферты в PDF.

**Решения владельца и юриста остаются за ними** (§9): тексты, подписант, отдельные галочки,
повторное согласие, отзыв, доказательная база (IP и т. п.), возраст.

### 1.2 PDF сертификата (#11, флаг `CERT_PDF`)

**Входит:**
- Серверная генерация PDF через `@react-pdf/renderer`: A4 альбомный по BRAND «Сертификат».
- Маршрут `GET /[locale]/learn/[slug]/certificate/pdf`:
  - отдаёт только **свой** сертификат (по сессии);
  - гость — перенаправление на вход;
  - чужой или несуществующий — 404.
- Шрифты:
  - статические TTF-срезы Geologica Bold SHRP=100, Onest Regular и Onest SemiBold с латиницей,
    кириллицей и казахскими буквами;
  - лежат в `assets/fonts/pdf/` вместе с OFL;
  - срезы собирает скрипт с закреплёнными хэшами.
- QR — вектором (`<Svg><Path>`) из матрицы `qrcode`, ведёт на `/{cert.locale}/cert/{number}`.
- Кэширование:
  - PDF не храним;
  - ETag от данных и версии макета, `304` после проверки владельца;
  - `Cache-Control: private, no-cache`;
  - лимит частоты на пользователя.
- Флаг выключен — остаётся текущая печать браузером, маршрут отвечает 404.

**Не входит:**
- PDF сертификата для админа или руководителя;
- массовая выгрузка;
- факсимиле подписи и печать (вопрос В-8);
- хранение PDF.

---

## 2. Модель данных

### 2.1 Миграция `migrations/2026-10-20-legal-consents.sql` (полный текст)

Имя сортируется после `2026-10-19-init.sql`: зависимость только от `consents`. Миграция
идемпотентна и только добавляет.

```sql
-- Юридические документы и согласия (#17). Нормативно: docs/lms/BUILD.md §3, DECISIONS D-025.
-- Идемпотентно, только добавляет. Тексты документов — файлы content/legal/**, реестр —
-- src/lib/legal/registry.ts. Здесь — неизменяемые копии принятых текстов (адресация по
-- SHA-256) и связь согласия с точным текстом.

CREATE TABLE IF NOT EXISTS legal_texts (
  sha256     TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  kind       TEXT NOT NULL CHECK (kind IN ('offer', 'privacy', 'pd_consent', 'refund', 'cross_border')),
  version    TEXT NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]{1,2})?$'),
  locale     TEXT NOT NULL CHECK (locale IN ('ru', 'kz')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,             -- нормализованный исходник целиком (с заголовком)
  draft      BOOLEAN NOT NULL,          -- черновик, не утверждён юристом
  created_at BIGINT NOT NULL            -- когда текст впервые принят пользователем
);
CREATE INDEX IF NOT EXISTS legal_texts_doc_idx ON legal_texts (kind, version, locale);

-- Согласие ↔ точный текст. Старые строки (до #17): text_sha256 IS NULL, version '2026-10-19'.
ALTER TABLE consents ADD COLUMN IF NOT EXISTS locale TEXT
  CHECK (locale IS NULL OR locale IN ('ru', 'kz'));
ALTER TABLE consents ADD COLUMN IF NOT EXISTS context TEXT
  CHECK (context IS NULL OR context IN ('register', 'checkout'));
ALTER TABLE consents ADD COLUMN IF NOT EXISTS text_sha256 TEXT
  REFERENCES legal_texts (sha256) ON DELETE RESTRICT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS withdrawn_at BIGINT;   -- отзыв согласия (процесс — позже)

CREATE INDEX IF NOT EXISTS consents_order_idx ON consents (order_id);
CREATE INDEX IF NOT EXISTS consents_user_kind_idx ON consents (user_id, kind, created_at);

-- Вид согласия — из закрытого списка. Существующие строки: только offer и pd_processing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'consents_kind_check' AND t.relname = 'consents' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE consents ADD CONSTRAINT consents_kind_check
      CHECK (kind IN ('offer', 'pd_processing', 'cross_border'));
  END IF;
END
$$;
```

Ограничения и инварианты:
- **`legal_texts` неизменяема.** Строки только вставляются (`ON CONFLICT (sha256) DO NOTHING`),
  кода `UPDATE` и `DELETE` нет. Один и тот же текст — одна строка (адресация по хэшу).
  Гонка двух вставок одного текста безопасна.
- **`consents`** тоже только вставляется. Исключение — будущий `withdrawn_at`.
- **`text_sha256` у новых строк** заполнен всегда, когда включён `LEGAL`. При выключенном
  `LEGAL` — `NULL` и `version = '2026-10-19'`, как сейчас (легаси-режим).
- **ПДн в `legal_texts` нет.** Это тексты документов.
- **Почему без `users`-FK в `legal_texts`:** текст не принадлежит пользователю.
- **Почему хэш, а не `(kind, version, locale)`:** если по ошибке поменять файл без новой
  версии, в БД останутся оба текста, и каждое согласие указывает на то, что человек видел.
  CI это и так ловит (тест хэшей), а БД — вторая линия.

### 2.2 Файлы текстов (не БД)

```
content/legal/
  offer/2026-10-20.ru.md        offer/2026-10-20.kz.md
  privacy/2026-10-20.ru.md      privacy/2026-10-20.kz.md
  pd-consent/2026-10-20.ru.md   pd-consent/2026-10-20.kz.md
  refund/2026-10-20.ru.md       refund/2026-10-20.kz.md
```

Формат файлов:
- Markdown, первая строка — `# Заголовок`, без HTML и без frontmatter.
- Метаданные (черновик, дата вступления, хэши) — в реестре.
- Нормализация перед хэшем:
  - убрать BOM;
  - `\r\n` и `\r` → `\n`;
  - Unicode NFC;
  - обрезать пробелы в конце строк;
  - ровно один `\n` в конце.
- `sha256` — hex от UTF-8 нормализованной строки.

Почему тексты не в `messages/*.json`. Правило «тексты — только в локалях» касается строк
интерфейса. Документ на 5–20 страниц — это контент, как уроки курса: в JSON такой текст не
проверить и не сравнить построчно. Подписи, заголовки страниц и пометки — в
`messages/{ru,kz}/legal.json`.

---

## 3. Модули и файлы

Зоны:
- **legal** — новая зона: `src/lib/legal/**`, `src/app/[locale]/legal/**`,
  `src/components/legal/**`, `content/legal/**`, `messages/*/legal.json`;
- **certpdf** — внутри зоны learn: `src/lib/learn/pdf/**`,
  `src/app/[locale]/learn/[slug]/certificate/pdf/route.ts`, плюс `assets/fonts/pdf/**`
  (бренд-ассеты).

### 3.0 Общие правки (оркестратор, шаг 0)

| Файл | Правка |
|---|---|
| `package.json`, `package-lock.json` | `"@react-pdf/renderer": "4.9.0"` (точный пин; peer react ^19 — ок) |
| `next.config.ts` | `outputFileTracingIncludes`: в `'/**'` добавить `'./content/legal/**'`; новый ключ `'/[locale]/learn/[slug]/certificate/pdf': ['./assets/fonts/pdf/**', './docs/brand/logo/crp-logo.png']`. В `serverExternalPackages` ничего не добавлять: `@react-pdf/renderer` уже во встроенном списке Next |
| `src/lib/features.ts` | если ещё нет — по общему контракту: `isFeatureEnabled(name, env = process.env)`; `FEATURE_<NAME>=1\|0`, иначе `isDemo()` |
| `src/lib/i18n/request.ts` | `NAMESPACES` += `'legal'` |
| `docs/lms/BUILD.md` | §1: строка `@react-pdf/renderer 4.9.0`; §3: `legal_texts`, новые колонки `consents`; §6: маршруты legal и PDF; §8: namespace `legal`; §12: зона legal |
| `DECISIONS.md` | записи из §10 этого проекта (номера — следующие свободные; на момент записи последний — D-024) |

### 3.1 Юридические документы — `src/lib/legal/`

**`types.ts`**

```ts
export const LEGAL_DOC_KINDS = ['offer', 'privacy', 'pd_consent', 'refund'] as const;
export type LegalDocKind = (typeof LEGAL_DOC_KINDS)[number];

/** Сегмент URL и папка content/legal: pd_consent → pd-consent. */
export const LEGAL_DOC_SLUG: Record<LegalDocKind, string> = {
  offer: 'offer', privacy: 'privacy', pd_consent: 'pd-consent', refund: 'refund',
};
export function docKindFromSlug(slug: string): LegalDocKind | null;

export const CONSENT_KINDS = ['offer', 'pd_processing', 'cross_border'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
/** Какой документ принимается согласием. cross_border — текст появится вместе с провайдером. */
export const CONSENT_DOC: Record<ConsentKind, LegalDocKind | null> = {
  offer: 'offer', pd_processing: 'pd_consent', cross_border: null,
};
export type ConsentContext = 'register' | 'checkout';

/** Версия до #17: так помечены согласия без текста (легаси-режим при выключенном LEGAL). */
export const LEGACY_CONSENT_VERSION = '2026-10-19';

export type LegalVersion = {
  kind: LegalDocKind;
  version: string;            // 'YYYY-MM-DD' или 'YYYY-MM-DD-N' — дата редакции
  effectiveFrom: string;      // 'YYYY-MM-DD', с какого дня действует
  draft: boolean;             // true — заглушка, не утверждена юристом
  sha256: { ru: string; kz: string | null };   // kz: null — казахской версии нет, показываем ru
};

export type LegalText = {
  kind: LegalDocKind; version: string; draft: boolean; effectiveFrom: string;
  locale: 'ru' | 'kz';        // язык показанного текста (после запасного ru)
  fallback: boolean;          // просили kz, показали ru
  title: string; body: string; // body — markdown без строки заголовка
  source: string;             // нормализованный исходник целиком (то, что хэшируется)
  sha256: string;
};
```

**`registry.ts`** — единственный реестр версий. Старшая версия — первая в массиве.

```ts
export const LEGAL_VERSIONS: readonly LegalVersion[];
/** Действующая версия: старшая с effectiveFrom <= today. Черновики — только если allowDrafts. */
export function currentVersion(kind: LegalDocKind, opts: { allowDrafts: boolean; today?: string }): LegalVersion | null;
export function findVersion(kind: LegalDocKind, version: string): LegalVersion | null;
export function versionsOf(kind: LegalDocKind): readonly LegalVersion[];
/** Токен показанных версий для формы: 'offer@2026-10-20;pd_consent@2026-10-20' (сортировка по kind). */
export function versionsToken(kinds: readonly ConsentKind[], opts: { allowDrafts: boolean }): string;
```

**`source.ts`** — чистые функции, без fs:

```ts
export function normalizeLegalSource(raw: string): string;
export function legalSha256(normalized: string): string;           // node:crypto
export function splitTitle(normalized: string): { title: string; body: string }; // нет '# ' в 1-й строке → Error
```

**`texts.ts`** (сервер):
- путь файла строится **только из реестра**, не из параметров запроса;
- кэш — `Map` в памяти процесса.

```ts
/** content/legal/<slug>/<version>.<locale>.md; хэш ≠ реестру → Error (fail closed, 500 и лог). */
export async function loadLegalText(v: LegalVersion, locale: 'ru' | 'kz'): Promise<LegalText>;
```

**`flags.ts`**

```ts
/**
 * LEGAL включён и можно публиковать: в демо — всегда при флаге;
 * в production — только если у offer, privacy, pd_consent, refund есть действующая
 * НЕчерновая версия. Черновики в production не публикуются (fail closed).
 */
export function isLegalEnabled(): boolean;
/** allowDrafts = isDemo(). */
export function legalAllowDrafts(): boolean;
```

**`consents.ts`**

```ts
export type PreparedConsent = {
  kind: ConsentKind;
  version: string;
  locale: 'ru' | 'kz' | null;
  text: LegalText | null;          // null — легаси-режим
};

/** Подготовка вне транзакции (чтение файлов). LEGAL выкл → легаси-версия без текста. */
export async function prepareConsents(kinds: readonly ConsentKind[], locale: 'ru' | 'kz'): Promise<PreparedConsent[]>;

/** Проверка токена из формы: при выключенном LEGAL всегда true. */
export function consentTokenFresh(token: unknown, kinds: readonly ConsentKind[]): boolean;

/**
 * Запись внутри транзакции вызывающего (регистрация, заказ):
 * INSERT legal_texts ... ON CONFLICT (sha256) DO NOTHING; затем INSERT consents
 * (kind, version, locale, context, text_sha256, user_id, order_id, created_at).
 */
export async function insertConsents(
  sql: Sql,
  input: { userId: string; orderId: string | null; context: ConsentContext; at: number; consents: PreparedConsent[] },
): Promise<void>;

export type ConsentView = {
  kind: ConsentKind; version: string; locale: string | null; context: string | null;
  createdAt: number; orderNumber: string | null; textSha256: string | null; withdrawnAt: number | null;
};
/** Для карточки пользователя в админке (вызов — только после requireAdmin). */
export async function listUserConsents(userId: string): Promise<ConsentView[]>;
```

**`index.ts`** — реэкспорт публичного API.

### 3.2 Страницы и компоненты legal

| Файл | Что |
|---|---|
| `src/app/[locale]/legal/page.tsx` | список документов: строки с тонкими разделителями; в строке название и «Редакция от {date}», у черновика — `Badge` «Черновик» |
| `src/app/[locale]/legal/[doc]/page.tsx` | действующая редакция. `docKindFromSlug` → null или `!isLegalEnabled()` → `notFound()`. `currentVersion(kind, { allowDrafts })` → null → `notFound()` |
| `src/app/[locale]/legal/[doc]/[version]/page.tsx` | архивная редакция: `findVersion`; черновик вне демо → 404; пометка «Эта редакция действовала до {date}» и ссылка на действующую |
| `src/components/legal/LegalDocument.tsx` | `PageHeader` (крошки «Документы → …», h1 = заголовок из файла, lead = «Редакция от {date}»); `Alert` черновика (warning, с иконкой и текстом); пометка о запасном ru; карточка «бумага» узкой колонки с markdown; блок «Предыдущие редакции» |
| `src/components/legal/LegalMarkdown.tsx` | `react-markdown` + `remark-gfm`, **без** rehype-raw. `urlTransform`: только `http(s):`, `mailto:`, `tel:` и относительные; внешние ссылки — `rel="noopener noreferrer"` |
| `src/components/legal/ConsentLabel.tsx` | серверный хелпер для подписей галочек: `t.rich(key, { offer, privacy, consent, refund })`. Каждая ссылка — `<a href="/{locale}/legal/<slug>" target="_blank" rel="noopener">` и скрытый текст «открывается в новой вкладке» |
| `src/components/legal/legal.css` | только классы раскладки текста (ширина колонки ~72ch, отступы заголовков), на токенах |

Метаданные страниц:
- `title` — название документа;
- черновики — `robots: { index: false }`;
- архивные редакции — `index: false`;
- действующие утверждённые — индексируются.

Страницы динамические: подвал читает сессию, поэтому `generateStaticParams` не нужен.

### 3.3 Встраивание в регистрацию, заказ и подвал (чужие зоны — правки по согласованию)

**Регистрация** — `src/lib/auth/actions.ts` (foundation), `src/app/[locale]/register/{page,RegisterForm}.tsx`:
- Страница передаёт в форму:
  - `legal: { enabled: boolean; token: string }`;
  - готовую подпись `consentLabel: ReactNode` (`ConsentLabel` с ключом `legal.consent.register`;
    при выключенном LEGAL — старый `auth.register.consent`).
- Форма отправляет `legalToken` скрытым полем.
- `registerAction`, после проверки галочки:
  ```ts
  if (!consentTokenFresh(field(formData, 'legalToken'), ['pd_processing'])) return { error: 'legal_changed', values };
  const prepared = await prepareConsents(['pd_processing'], locale);   // до транзакции
  // в db.tx вместо прямого INSERT INTO consents:
  await insertConsents(sql, { userId, orderId: null, context: 'register', at: t, consents: prepared });
  ```
- В `AuthFormState.error` добавляется `'legal_changed'`. Текст ошибки — `legal.consent.changed`.
- Константа `PD_CONSENT_VERSION` удаляется, используется `LEGACY_CONSENT_VERSION` из
  `src/lib/legal`.
- ⚠ Проект mail тоже правит `registerAction` (EMAIL_VERIFY). Правки независимы
  (разные места функции), но в одном файле. Вливать последовательно, второй PR делает
  rebase (§8).

**Заказ** — `src/lib/orders/{types,validation,create}.ts`, `src/components/checkout/CheckoutForm.tsx`,
`src/app/[locale]/courses/[slug]/buy/page.tsx`. Это зона checkout, Opus: деньги.
- **`validation.ts`:**
  - `parseCheckout(raw, opts: { legal: boolean })`;
  - при `legal` поля `consentOffer` и `consentPd` (оба `'on'`, ошибки `required`) вместо
    `consent`;
  - `CHECKOUT_FIELDS` += `consentOffer`, `consentPd`;
  - в `CheckoutValues` — оба булевых.
- **`create.ts`:**
  - `CreateOrderOptions` += `consents: PreparedConsent[]`;
  - цикл `for (const kind of CONSENT_KINDS) INSERT ...` → `insertConsents(sql, { userId, orderId: id, context: 'checkout', at: t, consents })`;
  - согласия пишутся **только для нового заказа**, как сейчас: для `existing` ничего не пишем.
- **`types.ts`:** `CONSENT_VERSION` и `CONSENT_KINDS` удаляются, вместо них импорт из
  `src/lib/legal` (`['offer', 'pd_processing'] as const` — константа `CHECKOUT_CONSENTS` в
  `src/lib/legal/types.ts`).
- **Server action заказа** (`src/lib/orders/actions.ts`):
  - проверяет `consentTokenFresh(raw.legalToken, CHECKOUT_CONSENTS)`; устарел →
    `{ error: 'legal_changed' }`, галочки сбрасываются;
  - затем `prepareConsents(CHECKOUT_CONSENTS, locale)`, затем `createOrder`.
- **`CheckoutForm`:**
  - при `legal.enabled` — две галочки с подписями `legal.consent.checkoutOffer` и
    `legal.consent.checkoutPd`, иначе прежняя одна;
  - скрытое поле `legalToken`.
- **Сид:** `seed/activity.ts` берёт `LEGACY_CONSENT_VERSION` из `src/lib/legal`. Демо-строки
  остаются легаси (`text_sha256 NULL`), снимок демо-БД не меняется.

**Подвал** — `src/components/layout/Footer.tsx` (foundation). При `isLegalEnabled()`
добавляется колонка `<nav aria-labelledby="footer-legal">` «Документы»: оферта, политика
обработки ПДн, условия возврата. Согласие отдельно не выносим: оно открывается из политики и
из подписей галочек.

**Админка** (шаг A4, зона admin). В `admin/users/[id]/page.tsx` — блок «Согласия»
(`listUserConsents`): вид, редакция со ссылкой на `/legal/<slug>/<version>`, язык, контекст,
номер заказа, дата. Для легаси-строк — «редакция до публикации документов».

### 3.4 PDF сертификата — `src/lib/learn/pdf/`

| Файл | API |
|---|---|
| `theme.ts` | цвета — только токены BRAND (`#FFFFFF`, `#14161B`, `#4A4F59`, `#6B707A`, `#E31E24`); размеры листа `A4_LANDSCAPE = { width: 841.89, height: 595.28 }` (pt) |
| `layout.ts` (чистые функции) | `nameFontSize(name: string): number` — 47 / 38 (> 28 знаков) / 32 (> 40) / 26 (> 60); `courseFontSize(title: string): number` — 25 / 21 (> 60) / 18 (> 100); `sanitizePdfText(s: string): string` — убрать C0/C1-управляющие и bidi-override (U+202A–202E, U+2066–2069), схлопнуть пробелы, обрезать до 200 |
| `qr.ts` | `qrPath(text: string): { size: number; d: string }` — из `QRCode.create(text, { errorCorrectionLevel: 'M' })`, один `d` из прямоугольников модулей (`M x y h1 v1 h-1 z`), склейка по строкам |
| `fonts.ts` | `ensurePdfFonts(): void` — регистрирует один раз на процесс (флаг в `globalThis`). `Font.register({ family: 'Geologica', fonts: [{ src, fontWeight: 700 }] })` и `Font.register({ family: 'Onest', fonts: [{ src: …Regular, fontWeight: 400 }, { src: …SemiBold, fontWeight: 600 }] })`. `src` — абсолютный путь `path.join(process.cwd(), 'assets/fonts/pdf/<file>')`. `Font.registerHyphenationCallback((w) => [w])` — без переносов внутри слов: английские правила ломают кириллицу |
| `CertificateDocument.tsx` | `CertificateDocument(props: CertificatePdfProps)` — дерево `<Document><Page size="A4" orientation="landscape">…`. Без хуков и без next-intl внутри: все строки приходят в props |
| `render.ts` | `renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array>` — `ensurePdfFonts()`, читает логотип (`docs/brand/logo/crp-logo.png`, кэш), `renderToBuffer(<CertificateDocument …/>)` |
| `etag.ts` | `certificatePdfEtag(input: CertificatePdfInput): string` — `W/"<sha256 hex 32>"` от `CERT_PDF_TEMPLATE_VERSION`, number, holderName, courseTitle, issuedAt, locale, verifyUrl |
| `data.ts` | `loadCertificatePdfInput(userId: string, slug: string): Promise<CertificatePdfInput \| null>` — `getCourse({ slug })` (опубликован, иначе null), `getCertificate(userId, course.id)` (нет → null), строки `learn.certificate.sheet` через `getTranslations({ locale: cert.locale, … })`, дата — `formatDate(issuedAt, cert.locale)`, `verifyUrl = certificateVerifyUrl(publicSiteUrl(), cert.locale, cert.number)` |

```ts
export const CERT_PDF_TEMPLATE_VERSION = 1;

/** Всё, что попадает в PDF. Email и id пользователя сюда не передаются (тип это исключает). */
export type CertificatePdfInput = {
  number: string;                 // CERT_NUMBER_RE
  holderName: string;
  courseTitle: string;            // уже выбранный по cert.locale
  issuedAt: number;
  locale: 'ru' | 'kz';            // язык сертификата = язык прохождения
  verifyUrl: string;
  labels: {                       // learn.certificate.sheet.*
    title: string; certifies: string; completed: string; issued: string; number: string;
    org: string; place: string; qrTitle: string; issuedDate: string; verifyHost: string;
    metaTitle: string;            // «Сертификат {number}» — свойство Title у PDF
  };
};
```

**Публичный адрес для QR** — `publicSiteUrl()` в `src/lib/learn/pdf/data.ts`:
- вызывает `siteUrl()`;
- если `NODE_ENV === 'production' && !isDemo()` и не задан `NEXT_PUBLIC_SITE_URL` — бросает
  `PdfConfigError` (маршрут отвечает 503).

Иначе QR на проде вёл бы на `http://localhost:3000`. Адрес не берётся из заголовка `Host`.

**Маршрут** `src/app/[locale]/learn/[slug]/certificate/pdf/route.ts`
(`.ts`: JSX только в `CertificateDocument.tsx`):

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  // 1. !isFeatureEnabled('CERT_PDF') → 404 text/plain, no-store
  // 2. locale (hasLocale, иначе default); slug = routeParam(raw)
  // 3. user = getCurrentUser(); нет → 303 на /{locale}/login?next=/{locale}/learn/{slug}/certificate
  //    (next — на страницу сертификата, а не на PDF)
  // 4. лимит: rateLimit(`cert-pdf:${user.id}`, 10, 60_000) — нет → 429 + Retry-After
  // 5. input = loadCertificatePdfInput(user.id, slug); null → 404 (одинаково для «нет курса» и «нет сертификата»)
  // 6. etag = certificatePdfEtag(input); If-None-Match совпал → 304 (после шагов 3–5!)
  // 7. const { renderCertificatePdf } = await import('@/lib/learn/pdf/render');  // тяжёлый модуль — лениво
  //    body = await renderCertificatePdf(input)
  // 8. 200, заголовки:
  //    Content-Type: application/pdf
  //    Content-Disposition: attachment; filename="<number>.pdf"   (номер — ASCII по CERT_NUMBER_RE)
  //    Cache-Control: private, no-cache;  ETag;  Vary: Cookie;  X-Content-Type-Options: nosniff
  // Ошибки рендера → 500 без деталей; console.error без ФИО (только number).
}
```

Лимит — в `src/lib/learn/limits.ts`: `CERT_PDF_LIMIT = { limit: 10, windowMs: 60_000 }` и
функция `certPdfAllowed(userId, nowMs?)`.

Журнал: скачивание PDF — не значимое событие, в `audit_log` не пишем. Выдача уже
журналируется: `certificate.issue`.

### 3.5 Макет PDF (BRAND «Сертификат», пересчёт HTML-листа в pt)

A4 альбомный, 841,89 × 595,28 pt, белый фон, `language` документа: `ru` или `kk`.

| Элемент | Значение |
|---|---|
| Рамка | `position: absolute`, отступ 17 pt от края, `border: 3pt solid #E31E24` (≈ 1 мм, как 4 px HTML-листа); padding внутри 29 / 39 / 27 pt |
| Логотип | `Image` с `src={{ data: Buffer, format: 'png' }}` из `docs/brand/logo/crp-logo.png` (940×196); ширина 185 pt (≈ 65 мм > минимума 30 мм; ≈ 367 dpi). Не перерисовываем, пропорции не меняем |
| «Сертификат» | Geologica 700, 27 pt, `letterSpacing` −0,54 |
| «Настоящим подтверждается, что» и «успешно завершил(а) обучение по курсу» | Onest 400, 12,6 pt, `#4A4F59` |
| ФИО | Geologica 700, `nameFontSize`, `letterSpacing` −0,03 em, `lineHeight` 1,05 |
| Курс | Geologica 700, `courseFontSize`, `maxWidth` 522 pt, `lineHeight` 1,15 |
| Низ — факты | подписи Onest 400, 8,8 pt, верхний регистр, `#6B707A`; значения Onest 600, 13 pt |
| Низ — подпись | ширина 185 pt, линия 1,2 pt `#14161B` сверху; «Центр Развития Предпринимателей» Onest 600, 11 pt; «Астана» 9,3 pt. Подписант — вопрос В-8 |
| Низ — QR | `Svg` 84 × 84 pt (≈ 30 мм) `viewBox="0 0 size size"`, `Path d fill="#14161B"`; вокруг белое поле ≥ 4 модулей; под ним «Проверка подлинности» (Onest 600, 8 pt) и `verifyHost` (8 pt, `#6B707A`) |
| Без | водяных знаков, теней, градиентов, колец, иконок (D-023) |

Шрифт `Geologica Bold SHRP=100` — статический срез: react-pdf (fontkit) не задаёт оси
вариативного шрифта. Поэтому «острота» SHRP 100 из BRAND запечена в файл.

### 3.6 Шрифты — `assets/fonts/pdf/`

```
assets/fonts/pdf/
  Geologica-Bold-SHRP100.ttf   # instancer: wght=700 SHRP=100 CRSV=0 slnt=0
  Onest-Regular.ttf            # wght=400
  Onest-SemiBold.ttf           # wght=600
  OFL-Geologica.txt            # копия OFL.txt из google/fonts/ofl/geologica
  OFL-Onest.txt
  README.md                    # источник (URL + commit google/fonts), команды, SHA-256 исходников и результатов
scripts/fonts/build-pdf-fonts.sh   # воспроизводимая сборка срезов
```

Сборка (Python, `fonttools==4.60.1` — точную версию закрепить в README; рантайму не нужна):

```sh
fonttools varLib.instancer "Geologica[CRSV,SHRP,slnt,wght].ttf" wght=700 SHRP=100 CRSV=0 slnt=0 -o g.ttf
pyftsubset g.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0400-052F,U+1C80-1C88,U+2000-206F,U+20AC,U+20B8,U+2116,U+2122,U+2212" \
  --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk' --output-file=Geologica-Bold-SHRP100.ttf
# то же для Onest[wght].ttf: wght=400 и wght=600
```

`U+0400–052F` покрывает кириллицу и cyrillic-ext: ә ғ қ ң ө ұ ү һ і и прописные.
`U+20B8` — знак тенге.

Почему так:
- **OFL** разрешает встраивать, распространять и изменять шрифт. Reserved Font Name у обоих
  шрифтов нет. Условие лицензии — OFL рядом с файлами.
- **Почему TTF-срезы в репозитории, а не fontsource и не Google CDN:**
  - fontsource режет шрифт по подмножествам на отдельные файлы, а react-pdf не умеет запасной
    шрифт по unicode-range;
  - статические срезы fontsource собраны с SHRP=0;
  - CDN в рантайме — внешний запрос и точка отказа.
- Размер трёх файлов — ориентир ≤ 250 КБ. В PDF встраивается только подмножество
  использованных глифов (делает pdfkit).

### 3.7 UI сертификата (зона learn)

**`learn/[slug]/certificate/page.tsx`:**
- `isFeatureEnabled('CERT_PDF')` — кнопка `<Button href="/{locale}/learn/{slug}/certificate/pdf" external download variant="primary">` «Скачать PDF» и подсказка `certificate.pdfHint`;
- выключен — прежние `PrintButton` и `printHint`;
- `external` (обычный `<a>`) обязателен: `next/link` делал бы prefetch маршрута и запускал
  генерацию PDF.

HTML-лист `CertificateSheet` остаётся для просмотра на экране и для печати, когда флаг
выключен.

**`learn/page.tsx`** (раздел «Сертификаты»), опционально в шаге B4: ссылка «Скачать PDF»
рядом с «Открыть» — при включённом флаге.

---

## 4. Сценарии, экраны, ключи локалей

### 4.1 Сценарии

1. **Гость открывает подвал → «Публичная оферта».** На странице `PageHeader` с крошками
   «Документы → Публичная оферта», строка «Редакция от 20 октября 2026 г.». В демо — плашка
   «Черновик…». Ниже — текст. Внизу «Предыдущие редакции», если они есть.
2. **Регистрация.** Галочка: «Даю *согласие на сбор и обработку персональных данных* и
   ознакомлен(а) с *политикой обработки персональных данных*». Ссылки открываются в новой
   вкладке. Без галочки — прежняя ошибка. Если редакция сменилась, пока форма была открыта, —
   «Условия обновились…», галочка сброшена. В БД — `consents` (`pd_processing`, версия, `kz`
   или `ru`, `register`, хэш) и строка `legal_texts`.
3. **Покупка.** Две галочки:
   - «Принимаю условия *публичной оферты* и *условия возврата*»;
   - «Даю *согласие на сбор и обработку персональных данных*, указанных в заказе».
   Без любой из них — ошибка под этой галочкой. В БД — две строки `consents` с `order_id`.
4. **Админ → Пользователи → карточка.** Блок «Согласия»: «Согласие на обработку ПДн · ред.
   20.10.2026 · kz · регистрация · 21.10.2026 14:05», ссылка на редакцию.
5. **Сертификат (флаг включён).** «Ваш сертификат» → «Скачать PDF» → файл `CRP-2026-AB23CD.pdf`
   на языке прохождения курса. Повторный клик — тот же файл (`304`, если браузер прислал ETag).
6. **Чужой пользователь открывает ту же ссылку PDF** — 404. Гость — вход, затем возврат на
   страницу сертификата.
7. **Флаги выключены (production по умолчанию).** Ссылок «Документы» нет, `/legal/*` → 404,
   галочки прежние и без ссылок, согласия пишутся по-старому. Сертификат — печать браузером,
   маршрут PDF → 404.

### 4.2 `messages/ru/legal.json`

```json
{
  "meta": { "index": "Документы" },
  "index": {
    "title": "Документы",
    "lead": "Оферта, политика обработки персональных данных, согласие и условия возврата."
  },
  "docs": {
    "offer": "Публичная оферта",
    "privacy": "Политика обработки персональных данных",
    "pd_consent": "Согласие на сбор и обработку персональных данных",
    "refund": "Условия возврата"
  },
  "doc": {
    "edition": "Редакция от {date}",
    "draftBadge": "Черновик",
    "draft": "Черновик. Текст готовит и утверждает юрист ЦРП. Пока документ не утверждён, он не действует.",
    "fallback": "Казахская версия документа готовится. Ниже — текст на русском языке.",
    "archived": "Эта редакция действовала до {date}.",
    "toCurrent": "Действующая редакция",
    "history": "Предыдущие редакции"
  },
  "consent": {
    "register": "Даю <consent>согласие на сбор и обработку персональных данных</consent> и ознакомлен(а) с <privacy>политикой обработки персональных данных</privacy>",
    "checkoutOffer": "Принимаю условия <offer>публичной оферты</offer> и <refund>условия возврата</refund>",
    "checkoutPd": "Даю <consent>согласие на сбор и обработку персональных данных</consent>, указанных в заказе",
    "newTab": "открывается в новой вкладке",
    "changed": "Условия обновились. Откройте документы по ссылкам и отметьте согласие ещё раз.",
    "offerRequired": "Без согласия с офертой заказ не оформить.",
    "pdRequired": "Без согласия на обработку персональных данных заказ не оформить."
  },
  "footer": { "title": "Документы" },
  "admin": {
    "title": "Согласия",
    "empty": "Согласий нет.",
    "legacy": "редакция до публикации документов",
    "kind": { "offer": "Оферта", "pd_processing": "Обработка ПДн", "cross_border": "Трансграничная передача" },
    "context": { "register": "регистрация", "checkout": "заказ {number}" }
  }
}
```

### 4.3 `messages/kz/legal.json` (перевод требует проверки носителем, #13)

```json
{
  "meta": { "index": "Құжаттар" },
  "index": {
    "title": "Құжаттар",
    "lead": "Оферта, дербес деректерді өңдеу саясаты, келісім және қайтару шарттары."
  },
  "docs": {
    "offer": "Жария оферта",
    "privacy": "Дербес деректерді өңдеу саясаты",
    "pd_consent": "Дербес деректерді жинауға және өңдеуге келісім",
    "refund": "Қайтару шарттары"
  },
  "doc": {
    "edition": "{date} редакциясы",
    "draftBadge": "Жоба",
    "draft": "Жоба. Мәтінді ЦРП заңгері дайындайды және бекітеді. Құжат бекітілгенге дейін күшіне енбейді.",
    "fallback": "Құжаттың қазақша нұсқасы дайындалуда. Төменде — орыс тіліндегі мәтін.",
    "archived": "Бұл редакция {date} дейін қолданылды.",
    "toCurrent": "Қолданыстағы редакция",
    "history": "Алдыңғы редакциялар"
  },
  "consent": {
    "register": "<consent>Дербес деректерді жинауға және өңдеуге</consent> келісім беремін және <privacy>дербес деректерді өңдеу саясатымен</privacy> таныстым",
    "checkoutOffer": "<offer>Жария оферта</offer> шарттарын және <refund>қайтару шарттарын</refund> қабылдаймын",
    "checkoutPd": "Тапсырыста көрсетілген <consent>дербес деректерді жинауға және өңдеуге</consent> келісім беремін",
    "newTab": "жаңа бетте ашылады",
    "changed": "Шарттар жаңартылды. Құжаттарды сілтемелер арқылы ашып, келісімді қайта белгілеңіз.",
    "offerRequired": "Офертамен келіспей тапсырыс беру мүмкін емес.",
    "pdRequired": "Дербес деректерді өңдеуге келісімсіз тапсырыс беру мүмкін емес."
  },
  "footer": { "title": "Құжаттар" },
  "admin": {
    "title": "Келісімдер",
    "empty": "Келісімдер жоқ.",
    "legacy": "құжаттар жарияланғанға дейінгі редакция",
    "kind": { "offer": "Оферта", "pd_processing": "ДД өңдеу", "cross_border": "Трансшекаралық беру" },
    "context": { "register": "тіркелу", "checkout": "{number} тапсырысы" }
  }
}
```

### 4.4 Добавления в `messages/{ru,kz}/learn.json` → `certificate`

| Ключ | ru | kz |
|---|---|---|
| `certificate.pdfHint` | «Файл PDF, A4, альбомная ориентация.» | «PDF файл, A4, альбомдық бағдар.» |
| `certificate.pdfTooMany` | «Слишком много запросов. Попробуйте через минуту.» | «Сұраныс тым көп. Бір минуттан кейін қайталап көріңіз.» |
| `certificate.sheet.metaTitle` | «Сертификат {number}» | «Сертификат {number}» |
| `index.certificatePdf` | «Скачать PDF» | «PDF жүктеу» |

`certificate.download` («Скачать PDF») остаётся подписью кнопки в обоих режимах.

### 4.5 Заглушки текстов (`content/legal/**`)

Каждый файл начинается так:

```md
# Публичная оферта

> **Черновик.** Текст готовит и утверждает юрист ЦРП. Пока документ не утверждён, он не действует.

## 1. Термины
[заполняет юрист ЦРП]
...
```

Разделы-подсказки для юриста — только заголовки, без содержательных формулировок:
- **Оферта:** термины; предмет; порядок акцепта (оформление заказа и галочка); цена и порядок
  оплаты (Kaspi, счёт); срок доступа; права и обязанности; сертификат; возврат (ссылка на
  условия возврата); ответственность; персональные данные (ссылка на политику); реквизиты
  исполнителя `[заполняет юрист ЦРП]`.
- **Политика:** оператор; какие данные; цели; правовые основания; где хранятся (сервер в РК);
  кому передаются (руководитель организации видит прогресс сотрудника; публичная проверка
  сертификата — ФИО, курс, дата); трансграничная передача (сейчас нет); сроки хранения; права
  субъекта и отзыв согласия; меры защиты; контакты.
- **Согласие:** субъект; оператор `[наименование, БИН, адрес — юрист]`; перечень данных; цели;
  действия с данными; публичная проверка сертификата; передача руководителю организации;
  трансграничная передача — нет; срок действия; порядок отзыва.
- **Возврат:** когда возможен; как подать; сроки; что происходит с доступом (доступ
  закрывается, прогресс и сертификат сохраняются, SPEC §2).

Казахские файлы — те же заголовки по-казахски, с той же пометкой.

### 4.6 Требования закона РК (кратко; **проверить юристу ЦРП**, тексты закона мы не сверяли)

- **Закон РК от 21.05.2013 № 94-V «О персональных данных и их защите»:**
  - сбор и обработка — с согласия субъекта или законного представителя, кроме случаев,
    прямо указанных в законе;
  - согласие даётся письменно, электронным документом или иным способом с элементами
    защитных действий. Галочка с хранением версии и хэша текста, аккаунта и времени —
    наша реализация «иного способа», **подтвердить юристу**;
  - в согласии обычно указывают: оператора, цели, перечень данных, срок, сведения о передаче
    третьим лицам, о трансграничной передаче и о распространении в общедоступных источниках.
    У нас это ФИО на публичной странице проверки сертификата;
  - субъект вправе отозвать согласие — нужен порядок (В-6);
  - базы с ПДн граждан РК хранятся на территории РК (D-009);
  - трансграничная передача — отдельное условие (D-009).
- **Публичная оферта и акцепт** — нормы ГК РК о договоре (оферта, публичная оферта, акцепт
  конклюдентными действиями). Проверить формулировку акцепта.
- **Защита прав потребителей** — условия возврата и обязательная информация о продавце и
  услуге.
- **Закон «О языках в РК»** — документы на казахском и русском. У нас обе версии, `kz` до
  перевода показывается как запасной `ru` с пометкой. Допустимо ли это для оферты — В-1.
- **Несовершеннолетние** — согласие дают законные представители (В-10).

---

## 5. Безопасность и угрозы

| Угроза | Как закрыто |
|---|---|
| Подмена версии клиентом (согласие «на старый текст» или чужую версию) | Версию и текст выбирает сервер по реестру. Токен формы только сравнивается: не совпал → `legal_changed`, ничего не записано |
| Тихое изменение утверждённого текста | Хэш файла закреплён в реестре, unit-тест сверяет. В БД копия по хэшу: каждое согласие указывает на точный текст. Расхождение файла и реестра в рантайме → ошибка, а не запись с неверным хэшем |
| Черновик оферты публикуется на проде | `isLegalEnabled()`: вне демо требуется утверждённая (`draft: false`) действующая версия всех четырёх документов, иначе функция выключена целиком. Архивные черновики вне демо — 404 |
| Path traversal через `[doc]` и `[version]` | Путь к файлу строится только из записи реестра. Параметр лишь ищет запись (`docKindFromSlug`, `findVersion`) |
| XSS из markdown документа | `react-markdown` без raw HTML; `urlTransform` пропускает только `http(s)`, `mailto`, `tel`, относительные адреса; тексты приходят через PR и ревью |
| Согласие от имени другого пользователя | `userId` — только из сессии или нового аккаунта в той же транзакции. Согласия — в той же транзакции, что пользователь или заказ |
| ПДн в журналах | `legal_texts` без ПДн. В `audit_log` согласия не дублируются. В логах ошибок PDF — только номер |
| IDOR на PDF | Сертификат ищется по `(user.id из сессии, course по slug)`. Номер из URL не принимается. Чужой или несуществующий — одинаковый 404 (без перечисления) |
| Утечка email в PDF | `CertificatePdfInput` не содержит email и id пользователя (тип). Тест: в байтах PDF нет `@` и email |
| Нагрузка на CPU через генерацию PDF | Только вошедший владелец, лимит 10 в минуту на пользователя, `304` по ETag без рендера. Тяжёлый модуль грузится лениво |
| Кэширование чужого PDF прокси или CDN | `Cache-Control: private, no-cache`, `Vary: Cookie`. Публичного URL у файла нет |
| Подмена адреса в QR (Host header injection) | `verifyUrl` строится из `siteUrl()` (env). В проде без `NEXT_PUBLIC_SITE_URL` — 503, а не QR на localhost |
| Управляющие и bidi-символы в ФИО (подделка вида) | `sanitizePdfText` для ФИО и названия курса |
| Активное содержимое в PDF | react-pdf не создаёт JS-действий. Ссылок в PDF нет: QR — картинка |
| Цепочка поставки | `@react-pdf/renderer` — точный пин, lockfile, добавляет только оркестратор. Шрифты — из google/fonts по закреплённому коммиту с SHA-256 в README |
| Лицензия шрифтов | OFL рядом с файлами. Срезы не продаются отдельно. RFN нет — имя можно сохранить |
| Prefetch запускает генерацию | Ссылка — обычный `<a download>` (`external`), не `next/link` |

---

## 6. Флаги и демо

| | `LEGAL` | `CERT_PDF` |
|---|---|---|
| Включение | `isLegalEnabled()` = `isFeatureEnabled('LEGAL')` && (`isDemo()` или все 4 документа утверждены) | `isFeatureEnabled('CERT_PDF')` |
| Выключен: маршруты | `/legal`, `/legal/[doc]`, `/legal/[doc]/[version]` → `notFound()` | `GET …/certificate/pdf` → 404 text/plain |
| Выключен: UI | нет колонки «Документы» в подвале; галочки прежние, без ссылок и токена | кнопка «Скачать PDF» = `window.print()` (как сейчас) |
| Выключен: server actions | `registerAction` и заказ пишут согласия в легаси-режиме (`'2026-10-19'`, без хэша); `legalToken` игнорируется; поля `consentOffer` и `consentPd` не ожидаются | — |
| Демо | включён: черновики видны с плашкой «Черновик»; согласия пишутся с хэшем в PGlite и живут до перезапуска | включён: PDF генерируется в функции Vercel или Netlify, ничего не сохраняется, диск не нужен |

Переключение `LEGAL` при открытой форме: токен пустой или отличается → `legal_changed`, человек
отмечает галочку заново. Форма не ломается.

Production по умолчанию — оба выключены (`AGENTS.md`). Включение `LEGAL` на проде — после
утверждения текстов юристом. Без этого флаг не включит функцию из-за проверки черновиков.

---

## 7. Тесты

### 7.1 Unit (`tests/unit/`)

**`legal-source.test.ts`:**
- нормализация: BOM, CRLF, CR, NFC (й как `и` + U+0306 → U+0439), хвостовые пробелы, ровно
  один `\n`;
- `splitTitle`: ошибка без `# `;
- хэш стабилен.

**`legal-registry.test.ts`:**
- для **каждой** версии и локали хэш файла совпадает с реестром;
- `kz: null` ↔ файла нет;
- в `content/legal` нет файлов вне реестра;
- версии одного вида уникальны и отсортированы по убыванию;
- `effectiveFrom` ≥ даты версии;
- у каждого из 4 видов есть версия;
- `currentVersion` с `allowDrafts` false/true и `today`;
- `versionsToken` детерминирован (сортировка);
- `docKindFromSlug` отвергает `../offer`, `OFFER`, `pd_consent`.

**`legal-flags.test.ts`:** матрица `FEATURE_LEGAL` (1, 0, не задан) × `isDemo` × «все
утверждены». В production с черновиками — выключено даже при `FEATURE_LEGAL=1`.

**`legal-no-slop.test.ts`:** `legal.json` ru и kz — без стрелок, «N+», `eyebrow`, как
`learn-no-slop`. Паритет ключей и rich-тегов покрывает существующий `i18n-parity.test.ts`.

**`checkout-validation.test.ts`** (дополнить):
- `legal: true` — без `consentOffer` → `consentOffer: required`, без `consentPd` → `consentPd: required`;
- `legal: false` — прежнее поведение.

**`learn-pdf-layout.test.ts`:**
- пороги `nameFontSize` и `courseFontSize`;
- `sanitizePdfText` убирает U+202E, U+0000–001F, U+0080–009F и обрезает до 200;
- `qrPath`: размер матрицы для типичного URL (≥ 25), `d` непустой, ровно один `M` на модуль;
- `certificatePdfEtag` меняется от `courseTitle`, `holderName`, `CERT_PDF_TEMPLATE_VERSION` и
  стабилен при прочих равных.

**`learn-pdf-fonts.test.ts`** (помощник `tests/helpers/ttf-cmap.ts` — разбор `cmap` формата 4
и 12, ~60 строк):
- в каждом из 3 TTF есть глифы для А–Я, а–я, Ё, ё, ӘәҒғҚқҢңӨөҰұҮүҺһІі, A–Z, a–z, 0–9 и
  `«»№—–₸.,:;()-`;
- рядом лежат `OFL-*.txt`.

**`learn-pdf-config.test.ts`:** `publicSiteUrl()` бросает `PdfConfigError` в production без
`NEXT_PUBLIC_SITE_URL` вне демо и возвращает адрес в демо.

### 7.2 Integration (`tests/integration/`, PGlite; в CI ещё и Postgres 16)

**`legal-migration.test.ts`:**
- двойной `migrate` без ошибок;
- в `consents` есть колонки `locale`, `context`, `text_sha256`, `withdrawn_at`;
- ограничение `consents_kind_check` ровно одно;
- вставка `kind = 'foo'` падает;
- вставка `text_sha256`, которого нет в `legal_texts`, падает (FK).

**`legal-consents.test.ts`:**
- `insertConsents` при включённом `LEGAL`: строки `consents` с версией, локалью, контекстом и
  хэшем; строка `legal_texts.body` равна нормализованному файлу;
- повтор с тем же текстом — `legal_texts` не дублируется;
- при выключенном `LEGAL` — `version = '2026-10-19'`, `text_sha256 IS NULL`;
- kz без файла → `locale = 'ru'`, `fallback`.

**`core-auth-actions.test.ts` и fixture `auth-actions.flow.ts`** (дополнить):
- регистрация с `LEGAL` — согласие с хэшем;
- устаревший `legalToken` → `legal_changed`, пользователь **не создан**;
- без галочки → `consent`.

**`checkout-orders.test.ts`** (дополнить):
- `createOrder` с подготовленными согласиями — 2 строки с `order_id` и хэшами;
- повтор (`existing`) — согласия не добавляются.

**`checkout-concurrency.test.ts`** (только Postgres): два пользователя одновременно впервые
принимают один текст — оба заказа созданы, `legal_texts` — одна строка.

**`learn-certificate-pdf.test.ts`:**
- `loadCertificatePdfInput`:
  - владелец → данные;
  - другой пользователь → null;
  - нет сертификата → null;
  - курс в черновике → null;
  - доступ истёк или отозван → данные есть (сертификат сохраняется);
- `renderCertificatePdf` для `ru` и `kz` (казахское ФИО `Әлия Құрманғалиқызы`, название с ғ, ү):
  - байты начинаются с `%PDF-` и заканчиваются `%%EOF`;
  - `/Count 1`;
  - `/MediaBox [0 0 841.89 595.28]`;
  - есть `/BaseFont /…+Geologica` и `/…+Onest`;
  - размер < 400 КБ;
  - email из БД в байтах не встречается;
- обработчик маршрута как функция, с подменой env:
  - `FEATURE_CERT_PDF=0` → 404;
  - гость → 303 на login;
  - 11-й запрос за минуту → 429;
  - совпал `If-None-Match` → 304 без вызова рендера (шпион).

### 7.3 E2E (`tests/e2e/`, демо — флаги включены)

**`legal.spec.ts`:**
- гость: подвал → «Публичная оферта» → `h1`, плашка «Черновик»;
- `/kz/legal/privacy` открывается;
- `/ru/legal/unknown` → 404;
- `/ru/legal/offer/1999-01-01` → 404.

**`auth` (дополнить):** на регистрации у подписи галочки две ссылки с `target=_blank`;
регистрация проходит.

**`checkout.spec.ts`** (дополнить): две галочки; без «оферты» — ошибка у неё; с обеими — заказ
создан.

**`learn.spec.ts`** (дополнить):
- `client@crp.demo` → сертификат «Как проходит бизнес-разбор» → «Скачать PDF» → событие
  `download`, имя `CRP-…pdf`, первые байты `%PDF-`;
- `operator@crp.demo` по тому же URL → 404;
- гость → страница входа.

---

## 8. План реализации

Два исполнителя работают параллельно после шага 0. Пересечений по файлам нет, кроме
отмеченных.

| Шаг | Уровень | Кто | Файлы (зона) | Зависит |
|---|---|---|---|---|
| **0.1** Зависимость `@react-pdf/renderer@4.9.0` (точно), `npm i`, lockfile; `du -sh node_modules/@react-pdf node_modules/pdfkit node_modules/fontkit` — в отчёт (ориентир ≤ 15 МБ) | T0 | оркестратор / `mechanic` | `package.json`, `package-lock.json` | — |
| **0.2** `next.config.ts` (tracing, §3.0); `NAMESPACES += 'legal'`; `src/lib/features.ts`, если нет | T1 | `builder` | `next.config.ts`, `src/lib/i18n/request.ts`, `src/lib/features.ts` | — |
| **0.3** BUILD.md (§1, 3, 6, 8, 12) и записи DECISIONS (§10) — отдельным коммитом | T1 | оркестратор | `docs/lms/BUILD.md`, `DECISIONS.md` | ревью `reviewer` |
| **A1** Миграция; `src/lib/legal/{types,registry,source,texts,flags,consents,index}.ts`; заглушки `content/legal/**` (8 файлов) и их хэши в реестре; unit `legal-*`; integration `legal-migration`, `legal-consents` | T2→T1 | `builder` A | `migrations/2026-10-20-legal-consents.sql`, `src/lib/legal/**`, `content/legal/**`, `tests/{unit,integration}/legal-*` | 0.2 |
| **A2** Страницы и компоненты legal, `messages/{ru,kz}/legal.json`, `legal.css` | T1 | `builder` A | `src/app/[locale]/legal/**`, `src/components/legal/**`, `messages/*/legal.json` | A1 |
| **A3** Встраивание: регистрация, заказ (2 галочки, токен, `insertConsents`), подвал, сид | T2→T1 (деньги и ПДн: ревью Opus обязательно) | `builder` A | `src/lib/auth/actions.ts`, `src/app/[locale]/register/*`, `src/lib/orders/{types,validation,create,actions}.ts`, `src/components/checkout/CheckoutForm.tsx`, `src/app/[locale]/courses/[slug]/buy/page.tsx`, `src/components/layout/Footer.tsx`, `src/lib/db/seed/activity.ts`, тесты checkout и auth | A1, A2 (ключи `legal.consent.*`) |
| **A4** Админка: блок «Согласия» в карточке пользователя | T1 | `builder` A | `src/app/[locale]/admin/users/[id]/page.tsx`, `src/lib/admin/users.ts` (только чтение через `listUserConsents`) | A1 |
| **A5** E2E `legal.spec.ts`, дополнения `checkout` и `auth` | T1 | `tester` | `tests/e2e/legal.spec.ts`, `tests/e2e/checkout.spec.ts` | A3 |
| **B1** Срезы шрифтов: `scripts/fonts/build-pdf-fonts.sh`, `assets/fonts/pdf/*` (+ OFL, README с SHA-256); unit `learn-pdf-fonts` + `tests/helpers/ttf-cmap.ts`. Нет сети или fonttools → эскалация оркестратору (собрать вне песочницы), не подменять шрифтами из других источников | T1 | `builder` B | `scripts/fonts/**`, `assets/fonts/pdf/**`, `tests/unit/learn-pdf-fonts.test.ts`, `tests/helpers/ttf-cmap.ts` | — |
| **B2** `src/lib/learn/pdf/{theme,layout,qr,fonts,etag,CertificateDocument,render}.ts(x)`; unit `learn-pdf-layout`; integration рендера `ru`/`kz` | T2→T1 | `builder` B | `src/lib/learn/pdf/**`, `tests/unit/learn-pdf-*.test.ts` | 0.1, B1 |
| **B3** `data.ts` (`loadCertificatePdfInput`, `publicSiteUrl`), лимит в `limits.ts`, маршрут `certificate/pdf/route.ts`; integration `learn-certificate-pdf` | T2→T1 (доступ к ПДн: ревью Opus) | `builder` B | `src/lib/learn/pdf/data.ts`, `src/lib/learn/limits.ts`, `src/app/[locale]/learn/[slug]/certificate/pdf/route.ts`, `tests/integration/learn-certificate-pdf.test.ts` | B2, 0.2 |
| **B4** UI: кнопка на странице сертификата и ссылка в «Моём обучении»; ключи `learn.json` (ru и kz); e2e в `learn.spec.ts` | T1 | `builder` B | `src/app/[locale]/learn/[slug]/certificate/page.tsx`, `src/app/[locale]/learn/page.tsx`, `src/components/learn/*`, `messages/*/learn.json`, `tests/e2e/learn.spec.ts` | B3 |
| **R** Ревью перед пушем: код, миграция, docs; вручную — PDF на превью Vercel или Netlify (шрифты подхватились, `kz` без «тофу») | T2 | `reviewer` | — | все |

Порядок слияния и конфликты:
- **`src/lib/auth/actions.ts`** правят A3 и проект mail (EMAIL_VERIFY). Вливать
  последовательно; второй делает `git merge origin/main` и правит только свой фрагмент.
- **`src/app/[locale]/register/*`** — тот же порядок.
- **`messages/*/learn.json`** — только B4. **`messages/*/legal.json`** — только A2.
- **`next.config.ts`** и **`package.json`** — только шаг 0.
- **Миграция** только добавляет, имя `2026-10-20-legal-consents.sql`. С
  `2026-10-20-uploads.sql` проекта uploads не пересекается: разные таблицы, порядок
  безразличен.

Проверки каждого PR: `npm run typecheck`, `npm run lint`, `npm run test:unit`,
`npm run test:integration` (+ Postgres в CI), `npm run build`, `npm run test:e2e`.

---

## 9. Открытые вопросы владельцу и юристу ЦРП

| № | Вопрос | Рекомендуемый ответ |
|---|---|---|
| В-1 | Кто готовит и утверждает тексты оферты, политики, согласия и условий возврата на ru и kz, с какой даты они действуют? Можно ли, пока нет kz-текста, показывать ru с пометкой? | Юрист ЦРП готовит, директор утверждает. На проде `LEGAL` включаем только после утверждения обеих языковых версий. Запасной ru — только в демо |
| В-2 | На покупке одна галочка (оферта + ПДн) или две отдельные? | Две: согласие на ПДн отдельно от акцепта оферты |
| В-3 | Публичная страница проверки сертификата показывает ФИО, курс и дату. Включить это в согласие явно? | Да, отдельным пунктом согласия и политики |
| В-4 | Руководитель организации видит прогресс и результаты тестов сотрудника. Включить в согласие? | Да. Для сотрудников ЦРП — ещё и во внутренний документ работодателя |
| В-5 | При новой редакции согласия на ПДн просить повторное согласие у всех при входе или при следующем действии? | При следующем действии (покупка). Если меняются цели или состав данных — отдельный экран повторного согласия, отдельной задачей |
| В-6 | Как пользователь отзывает согласие? | Письмом на email ЦРП. Админ отмечает отзыв (`withdrawn_at`) и закрывает аккаунт. Интерфейс — отдельная задача |
| В-7 | Хранить IP и браузер при согласии как доказательство? | Нет, по принципу минимизации: аккаунт, время, версия и хэш текста. Юристу подтвердить, что этого достаточно |
| В-8 | Подписант на сертификате: должность и ФИО руководителя ЦРП (BRAND `[дозаполни]`). Нужны ли факсимиле подписи или печать? | Должность и ФИО текстом, без факсимиле и печати: изображение подписи в общедоступном PDF легко скопировать |
| В-9 | Название документа «Сертификат» и формулировка «успешно завершил(а) обучение по курсу» подходят для негосударственного обучения? | Оставить «Сертификат», без слов о государственном образце и квалификации. Юристу подтвердить |
| В-10 | Возраст пользователей: только 18+? | 18+ в оферте. Несовершеннолетних не регистрируем |
| В-11 | Нужна ли лицензия или уведомление для платных онлайн-курсов ТОО (неформальное образование)? | Вопрос юристу. Разработку не блокирует |

---

## 10. Записи для `DECISIONS.md` (добавляет оркестратор; номера — следующие свободные)

```
## D-025 · 2026-10-19 · Юридические документы: тексты в репозитории, согласие с хэшем текста
Статус: принято (дизайн architect, #17); тексты и условия — за юристом ЦРП
Решение. Оферта, политика обработки ПДн, согласие на обработку ПДн и условия возврата —
markdown-файлы `content/legal/<doc>/<версия>.<ru|kz>.md`; реестр версий с SHA-256 —
`src/lib/legal/registry.ts`, тест сверяет хэши. Согласие (`consents`) хранит вид, версию,
язык, контекст и `text_sha256`; копия принятого текста — в `legal_texts` (адресация по хэшу,
только вставка). Форма отправляет токен показанных версий; сменилась редакция — согласие
отмечается заново. В production черновики не публикуются: флаг `LEGAL` действует, только
если все четыре документа утверждены. Покупка — две галочки: оферта и ПДн.
Почему. Доказать, с каким именно текстом согласился человек, а не только «версию». Тексты
меняются редко и через ревью, отдельный редактор в админке не окупается. Копия в БД
переживёт перенос репозитория и попадает в бэкапы.
Отвергли. Тексты в БД с редактором в админке — больше кода и поверхности атаки, без
ревью изменений. Тексты в `messages/*.json` — длинный документ в JSON не проверить. Только
строка версии без хэша — правка файла без новой версии незаметна.

## D-026 · 2026-10-19 · PDF сертификата на сервере: @react-pdf/renderer, статические срезы шрифтов
Статус: принято (дизайн architect, #11)
Решение. `GET /[locale]/learn/[slug]/certificate/pdf` рендерит PDF через
`@react-pdf/renderer` (пин 4.9.0, во встроенном списке serverExternalPackages Next) только
для владельца сертификата; PDF не хранится, кэш — ETag + `private, no-cache`, лимит 10 в
минуту на пользователя. Шрифты — статические TTF-срезы из вариативных Geologica
(wght 700, SHRP 100) и Onest (400, 600) с кириллицей и казахскими буквами, в
`assets/fonts/pdf/` с OFL; скрипт сборки и хэши в репозитории. QR — вектор из матрицы
`qrcode`. Без `NEXT_PUBLIC_SITE_URL` на проде маршрут отвечает 503.
Почему. Печать браузером зависит от настроек пользователя (поля, колонтитулы, масштаб).
react-pdf не задаёт оси вариативного шрифта и не умеет запасной шрифт по unicode-range,
поэтому нужен один статический файл на начертание.
Отвергли. Headless Chromium (Playwright/Puppeteer) на сервере — сотни МБ, не помещается в
serverless демо. Хранить PDF в БД или на диске — дубль ПДн, нет диска на Vercel/Netlify,
инвалидация при смене названия курса. Шрифты fontsource или Google CDN — SHRP=0,
разбиение по подмножествам, внешний запрос в рантайме.
```
