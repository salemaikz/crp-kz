# Проект: загрузка файлов (uploads)

> Проект до реализации. После реализации источник истины — код и docs/lms/BUILD.md; решения — DECISIONS.md. Статусы решений — только в DECISIONS.md.

Issue: #8 «Конструктор курсов: загрузка файлов». Флаг `UPLOADS`. Задел для #21
(практические задания). Уровень: T2→T1 (файлы, доступ к платному контенту,
ПДн — дизайн и ревью на Opus, реализация на Sonnet).

Источники: `AGENTS.md`, `docs/lms/BUILD.md` §2–§12, `docs/lms/SPEC.md` §4, §8,
`DECISIONS.md` D-009, D-012, D-015…D-023, код `src/lib/{db,auth,content,learn,admin,access.ts,env.ts}`,
`src/components/admin/lesson/*`, `src/components/learn/{Blocks,Markdown}.tsx`,
`src/components/catalog/CourseCover.tsx`, `next.config.ts`,
`node_modules/next/dist/docs/.../serverActions.md`, `proxyClientMaxBodySize.md`.

---

## 1. Цель и границы

**Цель.** Администратор загружает в конструкторе:
- картинки для уроков (блок «Изображение» и картинка внутри Markdown);
- материалы урока PDF/DOCX/XLSX (блок «Файл»);
- обложку курса.

Слушатель видит и скачивает файлы только при действующем доступе к уроку. Байты
хранятся на сервере ЦРП в РК (D-009), наружу по умолчанию ничего не уходит.

**Рекомендуемое решение (оформлено как D-034 в DECISIONS.md).**
1. Хранилище — абстракция `src/lib/storage/` с провайдером `local`: каталог
   `STORAGE_DIR` на сервере ЦРП, вне `public/` и вне каталога приложения.
   Провайдер `s3` (S3-совместимое хранилище в РК) — только интерфейс, подключается
   конфигом после решения владельца.
2. Загрузка — **route handler** `POST /api/uploads` с сырым телом
   (`application/octet-stream`), потоковой записью во временный файл и счётчиком
   байт. Server action для загрузки не используем, `serverActions.bodySizeLimit`
   остаётся 1 МБ по умолчанию.
3. Выдача — только `GET /api/files/[id]` с проверкой доступа на каждый запрос.
   Тип файла определяется по сигнатуре, а не по расширению и не по
   `Content-Type` клиента. Документы отдаются только как `attachment`.
4. Ссылки урока на файлы — таблица `lesson_files`. Её пересобирает сохранение
   урока по фактическому контенту. Доступ слушателя считается по ней.
   Неиспользуемые файлы удаляются подметанием через 24 часа.

**Отвергнутые варианты.**
- *Загрузка через server action (FormData).* Лимит тела общий для всех actions:
  чтобы принять 25 МБ, пришлось бы поднять его для всех actions. Тело
  буферизуется целиком до проверки сессии и роли. Прогресса загрузки нет.
- *Файлы в `public/` или статикой через Nginx.* Нет проверки доступа: платный
  материал утекает по ссылке. Каталог релиза пересоздаётся при каждой выкладке (D-027).
- *Байты в Postgres (bytea).* Раздувает БД и бэкапы. PGlite в демо держит всё в
  памяти. Потоковой выдачи нет.
- *Доступ «файл → курс» без учёта ссылок урока.* Файл, загруженный в черновик
  или удалённый из урока, оставался бы доступен всем зачисленным.

**Входит:**
- миграция и модули `storage` и `files`;
- маршруты загрузки и выдачи;
- блоки `image` и `file`, картинки и ссылки на файлы в Markdown;
- обложка курса, страница «Файлы курса», удаление и подметание сирот;
- квоты, лимиты частоты, журнал;
- поведение в демо;
- тесты.

**Не входит:**
- видео (D-008, issue #14);
- загрузки слушателей (#21 — только задел: `purpose='submission'`, правило доступа-заглушка);
- антивирус (вопрос владельцу);
- реализация провайдера `s3`;
- роль `author` (загружает только `admin`, как и весь конструктор);
- Range-запросы;
- просмотр PDF в браузере;
- перекодирование изображений (новых зависимостей нет).

**Решения владельца, которые остаются** — раздел 9: лимиты и квоты, PPTX,
антивирус, S3 в РК, демо на Vercel, PDF в браузере.

### Запись в DECISIONS.md

Перенесено в `DECISIONS.md` как D-034. Источник истины — там; лимиты, квоты, форматы
и антивирус — предложено, ждёт владельца.

Правки `docs/lms/BUILD.md` (оркестратор, тем же PR):
- §3: таблицы `files`, `lesson_files`, колонка `courses.cover_file_id`; блоки `image` и `file`.
- §6: маршруты `/api/uploads`, `/api/files/[id]`, `/[locale]/admin/courses/[id]/files`. Фраза
  «Route handlers — только для файлов (CSV)» → «Route handlers — только для файлов (CSV,
  загрузка и выдача файлов)».
- §8: пространство имён `files`.
- §12: зоны `src/lib/storage`, `src/lib/files`, `src/app/api/{uploads,files}` — новая зона
  **files** (владелец — исполнитель A, см. §8 плана).

---

## 2. Модель данных

Файл: `migrations/2026-10-20-uploads.sql`. Имя обязано сортироваться **после**
`2026-10-19-init.sql`, потому что есть FK на `courses`, `lessons`, `users`.
`2026-10-19-files.sql` сортируется раньше `init` — так называть нельзя.

```sql
-- Загрузка файлов (#8, D-034): метаданные файлов, ссылки уроков на файлы, обложка курса.
-- Байты — в хранилище (STORAGE_DIR / позже S3 в РК), не в БД.
-- Идемпотентно и только добавляет. Списки типов (mime, ext, kind) проверяет код:
-- новые форматы (например, PPTX) добавляются без смены ограничений.

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,                 -- UUID v4, он же в URL /api/files/<id>
  storage       TEXT NOT NULL CHECK (storage IN ('local', 's3')),
  storage_key   TEXT NOT NULL,                    -- генерирует сервер: '<2 hex>/<uuid>'; имя пользователя сюда не попадает
  purpose       TEXT NOT NULL CHECK (purpose IN ('lesson_material', 'course_cover', 'submission')),
                                                  -- 'submission' — резерв под #21, код пока его не создаёт
  kind          TEXT NOT NULL,                    -- 'image' | 'document' (проверяет код)
  mime          TEXT NOT NULL,                    -- определён по сигнатуре
  ext           TEXT NOT NULL,                    -- канонический: png, jpg, webp, pdf, docx, xlsx
  size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256        TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),  -- ETag
  original_name TEXT NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 160),  -- очищенное имя для показа
  width         INT CHECK (width IS NULL OR width > 0),
  height        INT CHECK (height IS NULL OR height > 0),
  course_id     TEXT REFERENCES courses (id) ON DELETE SET NULL,   -- курс, в который загружен
  lesson_id     TEXT REFERENCES lessons (id) ON DELETE SET NULL,   -- урок, из которого загружен (справочно)
  uploaded_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at    BIGINT NOT NULL,
  deleted_at    BIGINT,
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  UNIQUE (storage, storage_key)
);
CREATE INDEX IF NOT EXISTS files_course_active_idx ON files (course_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS files_status_created_idx ON files (status, created_at);

-- Какие файлы реально используются в контенте урока (обе локали). Пересобирается при сохранении урока.
CREATE TABLE IF NOT EXISTS lesson_files (
  lesson_id TEXT NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  file_id   TEXT NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, file_id)
);
CREATE INDEX IF NOT EXISTS lesson_files_file_idx ON lesson_files (file_id);

-- Обложка курса из хранилища. courses.cover (TEXT) остаётся адресом для витрины:
-- при установке пишется '/api/files/<id>', при снятии — NULL (оба поля в одном UPDATE).
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_file_id TEXT REFERENCES files (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS courses_cover_file_idx ON courses (cover_file_id);
```

**Инварианты (держит код, проверяют тесты):**
- `lesson_files(lesson_id, file_id)` — только файлы `status='active'`, `purpose='lesson_material'`,
  `files.course_id` = `lessons.course_id`.
- `courses.cover_file_id` — только `purpose='course_cover'`, `kind='image'`, `files.course_id` = этот курс.
- Строки `files` не удаляются физически: `status='deleted'` + `deleted_at`. Объект в хранилище
  удаляется после коммита. Строка остаётся для журнала и учёта.
- Учёт квоты — `sum(size_bytes) WHERE status='active'`.

---

## 3. Модули и файлы

### 3.1. Флаг (зависимость, не часть зоны uploads)

`src/lib/features.ts` — общий модуль флагов, его проектирует отдельная часть. Uploads
только импортирует:

```ts
export type FeatureName = 'PASSWORD_RESET' | 'EMAIL_VERIFY' | 'REMINDERS' | 'UPLOADS' | 'LEGAL' | 'CERT_PDF';
export function isFeatureEnabled(name: FeatureName): boolean; // FEATURE_<NAME>=1|0; иначе isDemo()
```

Если к шагу 1 модуля ещё нет, исполнитель шага 1 создаёт его ровно с этим контрактом.

### 3.2. `src/lib/storage/` — хранилище (зона files, исполнитель A)

| Файл | Что |
|---|---|
| `types.ts` | `StorageProvider`, `StorageKey`, `StorageObject` |
| `config.ts` | `storageConfig()`: провайдер, корень, лимиты по окружению (демо, serverless) |
| `local.ts` | провайдер `local` (fs/promises) |
| `index.ts` | `getStorage()`, `newStorageKey()`, `assertStorageKey()` |
| `limits.ts` | `FILE_TYPES`, `UPLOAD_LIMITS` (чистые константы, импортируются и клиентом) |
| `sniff.ts` | определение типа по сигнатуре: PNG/JPEG/WebP/PDF/ZIP, размеры изображений |
| `ooxml.ts` | разбор центрального каталога ZIP: DOCX/XLSX, отказ при макросах |
| `stripMeta.ts` | удаление EXIF/XMP/текстовых чанков из JPEG, PNG, WebP без перекодирования |
| `names.ts` | `sanitizeFileName`, `contentDisposition` |

```ts
// types.ts
export type StorageKey = string; // '<2 hex>/<uuid v4>' — только из newStorageKey()
export type StorageObject = { body: ReadableStream<Uint8Array>; size: number };
export interface StorageProvider {
  readonly name: 'local' | 's3';
  /** Готовность: корень существует и доступен на запись; свободное место (если известно). */
  health(): Promise<{ ok: boolean; freeBytes: number | null; reason?: string }>;
  /** Каталог для временных файлов загрузки (на том же томе, что объекты: rename атомарен). */
  tempDir(): Promise<string>;
  /** Перенести готовый временный файл в хранилище под новым ключом. */
  putFromTemp(key: StorageKey, tmpPath: string): Promise<void>;
  /** Поток объекта или null, если объекта нет. */
  open(key: StorageKey): Promise<StorageObject | null>;
  /** Удалить объект; отсутствие объекта — не ошибка. */
  remove(key: StorageKey): Promise<void>;
  /** Объекты старше olderThanMs (по mtime) — для подметания «бесхозных» объектов. */
  list(olderThanMs: number): AsyncIterable<{ key: StorageKey; mtimeMs: number }>;
}

// config.ts
export type StorageConfig =
  | { ok: true; provider: 'local'; root: string; demo: boolean; serverless: boolean }
  | { ok: false; reason: 'not_configured' | 'relative_path' | 'inside_app_dir' | 'provider_not_implemented' };
export function storageConfig(): StorageConfig;
/** Эффективный лимит размера для типа с учётом демо на serverless (4 МБ). */
export function maxBytesFor(kind: 'image' | 'document'): number;

// index.ts
export function getStorage(): StorageProvider;          // бросает StorageUnavailableError при !ok
export function newStorageKey(): StorageKey;            // `${uuid.slice(0,2)}/${uuid}`
export function assertStorageKey(key: string): StorageKey; // /^[0-9a-f]{2}\/[0-9a-f-]{36}$/, иначе Error

// limits.ts
export const FILE_TYPES = {
  png:  { mime: 'image/png',  kind: 'image' },
  jpg:  { mime: 'image/jpeg', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  pdf:  { mime: 'application/pdf', kind: 'document' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' },
} as const;
export type FileExt = keyof typeof FILE_TYPES;
export type FileKind = 'image' | 'document';
const MiB = 1024 * 1024;
export const UPLOAD_LIMITS = {
  imageBytes: 5 * MiB,
  documentBytes: 25 * MiB,
  serverlessDemoBytes: 4 * MiB,          // Vercel режет тело функции на 4,5 МБ, Netlify — на 6 МБ
  imageMaxSide: 10_000,
  imageMaxPixels: 40_000_000,            // защита браузера от «пиксельной бомбы»
  coverMinWidth: 800,
  coverMinHeight: 450,
  nameMax: 120,
  zipMaxEntries: 5_000,
  zipMaxCentralDirBytes: 4 * MiB,
  contentTypesMaxBytes: 1 * MiB,         // распаковка [Content_Types].xml
  uploadsPerUser: { limit: 60, windowMs: 10 * 60_000 },
  concurrentPerUser: 3,
  minFreeDiskBytes: 1024 * MiB,
  totalQuotaBytesDefault: 20 * 1024 * MiB,   // UPLOAD_QUOTA_BYTES
  courseQuotaBytesDefault: 2 * 1024 * MiB,   // UPLOAD_COURSE_QUOTA_BYTES
  orphanGraceMs: 24 * 60 * 60_000,
  tempGraceMs: 60 * 60_000,
  downloadsPerUser: { limit: 600, windowMs: 10 * 60_000 },
  downloadsPerIpGuest: { limit: 600, windowMs: 60_000 },
} as const;
export const PURPOSE_TYPES: Record<'lesson_material' | 'course_cover', readonly FileExt[]> = {
  lesson_material: ['png', 'jpg', 'webp', 'pdf', 'docx', 'xlsx'],
  course_cover: ['png', 'jpg', 'webp'],
};

// sniff.ts
export type Sniffed =
  | { ok: true; ext: FileExt; width?: number; height?: number }
  | { ok: false; reason: 'bad_type' | 'macro' | 'corrupt' };
/** Читает голову файла (до 64 КБ) и для ZIP — хвост и центральный каталог. Файл не распаковывается целиком. */
export async function sniffFile(path: string, size: number): Promise<Sniffed>;
export function sniffImageHeader(head: Uint8Array): { ext: 'png' | 'jpg' | 'webp'; width: number; height: number } | null;

// ooxml.ts
export function classifyOoxml(centralDir: ZipEntry[], contentTypesXml: string): 'docx' | 'xlsx' | 'macro' | null;

// stripMeta.ts
/** Копия изображения без EXIF/XMP/IPTC и текстовых чанков; пиксели не трогаются. */
export function stripImageMetadata(ext: 'png' | 'jpg' | 'webp', bytes: Uint8Array): Uint8Array;

// names.ts
export function sanitizeFileName(raw: string, ext: FileExt): string;
export function contentDisposition(kind: FileKind, name: string): string;
```

**Сигнатуры** (`sniff.ts`, `ooxml.ts`):
- PNG: `89 50 4E 47 0D 0A 1A 0A`, затем чанк `IHDR`, ширина и высота — байты 16–23.
- JPEG: `FF D8 FF`. Размеры — проход по маркерам до `SOF0..SOF15`, кроме `C4`, `C8`, `CC`.
- WebP: `RIFF....WEBP` с чанком `VP8 `, `VP8L` или `VP8X`, размеры из соответствующего чанка.
- PDF: `%PDF-1.` или `%PDF-2.` строго с нулевого смещения.
- ZIP: `PK 03 04`. Дальше — EOCD в последних 65 557 байтах, без ZIP64. Записей не больше
  `zipMaxEntries`. Имена не начинаются с `/` и не содержат `..` (иначе `corrupt`).
- DOCX: есть `[Content_Types].xml` и `word/document.xml`. В `[Content_Types].xml`
  (распаковка `node:zlib` `inflateRawSync` с `maxOutputLength`) основной тип —
  `...wordprocessingml.document.main+xml`.
- XLSX: то же с `xl/workbook.xml` и `...spreadsheetml.sheet.main+xml`.
- Макросы — `macro`: есть `vbaProject.bin`, `activeX/`, или в `[Content_Types].xml` встречается
  `macroEnabled`.
- Всё остальное — `bad_type`, в том числе:
  - SVG, HTML, GIF, HEIC;
  - ZIP без нужных частей;
  - CFB `D0 CF 11 E0`: старые DOC/XLS и зашифрованные OOXML.

**Имя** (`sanitizeFileName`):
- берётся часть после последнего `/` или `\`, затем NFC;
- удаляются управляющие символы, символы направления текста
  (U+200E/F, U+202A–202E, U+2066–2069) и `<>:"/\|?*`;
- пробелы схлопываются, точки и пробелы по краям обрезаются;
- длина основы ≤ `nameMax`;
- расширение **заменяется** каноническим `ext` из сигнатуры. Пример: `Отчёт.PDF.exe`
  с содержимым PDF → `Отчёт.PDF.pdf`;
- пустое имя → `file.<ext>`.

**`contentDisposition`:** `attachment` для document, `inline` для image, затем
`filename="<ASCII: не-ASCII и \" → _>"; filename*=UTF-8''<RFC 5987>`. Только ASCII,
без CR/LF.

**Провайдер `local`:**
- **Корень:** `STORAGE_DIR` (абсолютный). При первом обращении создаются `objects/` и
  `.tmp/` с режимом `0700`.
- **Объект:** `objects/<ab>/<uuid>`, режим `0600`, без расширения, без бита
  исполнения. Создаётся через `rename` из `.tmp`. Временный файл открывается с
  флагами `wx` (O_EXCL).
- **Путь:** `path.resolve(root, 'objects', assertStorageKey(key))` обязан начинаться
  с `root + sep` — вторая линия защиты от path traversal.
- **Симлинки:** `lstat` корня. Если `objects/` — симлинк, `health().ok = false`.
- **`health`:** `fs.statfs(root)` → `bavail * bsize`.

**`storageConfig`** (в `env.ts` не пишем — это зона foundation):
- `STORAGE_PROVIDER` пусто или `local` → провайдер `local`; `s3` →
  `provider_not_implemented` (fail closed).
- Корень — `STORAGE_DIR`. Если пусто и `isDemo()` — `path.join(os.tmpdir(), 'crp-demo-files')`.
  Если пусто вне демо — `not_configured`.
- Путь не абсолютный → `relative_path`.
- Вне демо корень внутри `process.cwd()` → `inside_app_dir`. Каталог релиза пересоздаётся
  при каждой выкладке (D-027), а `public/` раздаётся без проверки.
- `serverless = process.env.VERCEL === '1' || process.env.NETLIFY === 'true'`.

### 3.3. `src/lib/files/` — домен файлов (зона files, исполнитель A)

| Файл | Что |
|---|---|
| `types.ts` | `FileRow`, `StoredFile`, `UploadPurpose`, `UploadErrorCode`, `UploadError` (без серверных импортов — для клиента) |
| `url.ts` | `fileUrl(id)`, `FILE_URL_RE`, `isUuid` (чистые, для клиента и сервера) |
| `store.ts` | `storeUpload()` — загрузка целиком, без Next |
| `access.ts` | `canReadFile()` |
| `refs.ts` | ссылки урока на файлы: извлечение, проверка, снимки, `lesson_files` |
| `admin.ts` | список файлов курса, обложка, удаление, занятое место |
| `actions.ts` | `'use server'`: тонкие обёртки над `admin.ts` |
| `sweep.ts` | подметание сирот, бесхозных объектов и временных файлов |
| `http.ts` | `handleUpload`, `handleDownload`: Request → Response с внедрёнными зависимостями (тестируются без Next) |
| `limits.ts` | лимиты частоты загрузки и выдачи (через `rateLimit` из `src/lib/auth/rateLimit.ts`), счётчик одновременных загрузок |
| `format.ts` | `formatFileSize(bytes, locale)` через `Intl.NumberFormat` (`kk` для kz) |

```ts
// types.ts
export type UploadPurpose = 'lesson_material' | 'course_cover';
export type FileRow = {
  id: string; storage: 'local' | 's3'; storageKey: string; purpose: UploadPurpose | 'submission';
  kind: FileKind; mime: string; ext: FileExt; sizeBytes: number; sha256: string; originalName: string;
  width: number | null; height: number | null; courseId: string | null; lessonId: string | null;
  uploadedBy: string | null; status: 'active' | 'deleted'; createdAt: number; deletedAt: number | null;
};
export type StoredFile = {
  id: string; url: string; name: string; kind: FileKind; ext: FileExt; mime: string;
  sizeBytes: number; width: number | null; height: number | null;
};
export type UploadErrorCode =
  | 'disabled' | 'forbidden' | 'not_found' | 'bad_request' | 'cross_site' | 'length_required'
  | 'too_large' | 'empty' | 'bad_type' | 'macro' | 'image_too_large' | 'image_too_small'
  | 'quota' | 'rate_limited' | 'busy' | 'storage_unavailable';
export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode, readonly status: number, readonly params?: Record<string, string | number>);
}

// store.ts
export type UploadInput = {
  actor: { id: string; role: string };
  purpose: UploadPurpose;
  courseId: string;
  lessonId?: string | null;          // обязателен для lesson_material
  name: string;                      // из X-Upload-Name (уже декодирован)
  declaredSize: number;              // Content-Length
  body: AsyncIterable<Uint8Array>;
};
export async function storeUpload(input: UploadInput): Promise<StoredFile>; // бросает UploadError

// access.ts
export type FileReadDecision = { ok: true; cache: 'public' | 'private' } | { ok: false };
export async function canReadFile(user: { id: string; role: string } | null, file: FileRow): Promise<FileReadDecision>;

// refs.ts
export type FileRef = { locale: 'ru' | 'kz'; blockIndex: number; fileId: string; field: 'fileId' | 'markdown'; need: 'image' | 'any' };
export function collectFileRefs(content: LessonContent): FileRef[];
/** Проверяет ссылки (файл active, lesson_material, этого курса, нужного вида), переписывает
 *  снимки (name/ext/sizeBytes у file, width/height у image) из БД. Строки files — FOR SHARE.
 *  Ошибки → AdminError('VALIDATION', { content: 'invalid' }, issues с code 'file_not_found' | 'file_wrong_kind'). */
export async function resolveLessonFiles(sql: Sql, courseId: string, content: LessonContent):
  Promise<{ content: LessonContent; fileIds: string[] }>;
/** Заменяет набор lesson_files урока (DELETE отсутствующих + INSERT … ON CONFLICT DO NOTHING). */
export async function syncLessonFiles(sql: Sql, lessonId: string, fileIds: readonly string[]): Promise<void>;

// admin.ts (каждая функция начинает с assertAdmin(actor); при выключенном флаге — AdminError('FEATURE_DISABLED'))
export type CourseFileItem = StoredFile & { createdAt: number; uploadedByName: string | null;
  usedIn: Array<{ lessonId: string; title: L10n }>; isCover: boolean };
export async function listCourseFiles(actor: Actor, courseId: string): Promise<CourseFileItem[]>;
export async function storageUsage(actor: Actor, courseId: string):
  Promise<{ courseBytes: number; courseQuota: number; totalBytes: number; totalQuota: number }>;
export async function setCourseCover(actor: Actor, courseId: string, fileId: string): Promise<{ cover: string }>;
export async function clearCourseCover(actor: Actor, courseId: string): Promise<void>;
export async function deleteFile(actor: Actor, fileId: string): Promise<void>; // FILE_IN_USE, если есть ссылки или это обложка

// actions.ts ('use server'; как src/lib/admin/actions.ts: requireAdmin → функция → revalidatePath)
export async function setCourseCoverAction(locale: string, courseId: string, fileId: string): Promise<ActionResult<{ cover: string }>>;
export async function clearCourseCoverAction(locale: string, courseId: string): Promise<ActionResult>;
export async function deleteFileAction(locale: string, fileId: string): Promise<ActionResult>;

// sweep.ts
export async function sweepOrphanFiles(opts?: { graceMs?: number; limit?: number; dryRun?: boolean; nowMs?: number }):
  Promise<{ deleted: string[]; objectErrors: string[] }>;
export async function sweepStrayObjects(opts?: { graceMs?: number; dryRun?: boolean }): Promise<{ removed: string[] }>;
export async function sweepTemp(opts?: { graceMs?: number }): Promise<number>;

// http.ts
export type HttpDeps = { getUser: () => Promise<{ id: string; role: string } | null>; clientIp: (h: Headers) => string | null };
export async function handleUpload(req: Request, deps: HttpDeps): Promise<Response>;
export async function handleDownload(req: Request, id: string, deps: HttpDeps): Promise<Response>;
```

**Ошибки админки:** в `src/lib/admin/errors.ts` к `AdminErrorCode` добавляются
`'FEATURE_DISABLED' | 'FILE_IN_USE' | 'FILE_NOT_FOUND'`.

### 3.4. `storeUpload` — порядок проверок

1. `isFeatureEnabled('UPLOADS')`, иначе `disabled`, 404.
2. `assertAdmin(actor)`, иначе `forbidden`, 403. Роль сверяется с БД.
3. Параметры (zod):
   - `purpose` — из двух значений;
   - `courseId` — UUID, курс существует;
   - для `lesson_material` — `lessonId` из этого курса;
   - иначе `not_found`, 404.
4. Длина тела:
   - `declaredSize` — целое > 0, иначе `length_required` (411) или `empty` (400);
   - `declaredSize` ≤ максимальный лимит для `purpose`, иначе `too_large`, 413.
   - Для cover лимит — `maxBytesFor('image')`, для материала — максимум из image и document.
5. Лимит частоты на пользователя — иначе `rate_limited`, 429.
   Слот одновременных загрузок (не больше 3) — иначе `busy`, 429.
6. `storageConfig().ok` и `health().ok`, свободно ≥ `minFreeDiskBytes + declaredSize` —
   иначе `storage_unavailable`, 503.
7. Предварительная проверка квоты (без блокировки) — иначе `quota`, 507.
8. Потоковая запись в `tempDir()/<uuid>` (`wx`, `0600`) с подсчётом байт и `sha256`.
   Если байт больше `declaredSize` или лимита — обрыв, `too_large`, 413. Ноль байт — `empty`.
9. `sniffFile`. Ответ `bad_type` или `macro` — 415. Тип не входит в `PURPOSE_TYPES[purpose]` — `bad_type`.
   Фактический размер больше `maxBytesFor(kind)` — `too_large`.
10. Изображение:
    - сторона > `imageMaxSide` или пикселей > `imageMaxPixels` — `image_too_large`;
    - cover меньше 800×450 — `image_too_small`;
    - иначе `stripImageMetadata` → перезапись временного файла, пересчёт `size` и `sha256`.
11. `key = newStorageKey()`, затем `putFromTemp(key, tmp)`.
12. `db.tx`:
    - `pg_advisory_xact_lock(UPLOAD_QUOTA_LOCK_KEY)`;
    - точная проверка квот (общая и курса), иначе `quota`;
    - `INSERT files`;
    - `writeAudit('file.upload', 'file', id, { courseId, lessonId, purpose, ext, sizeBytes })`.
13. Ошибка транзакции → `remove(key)`. `finally` — `unlink(tmp)`, слот освобождается.

### 3.5. `canReadFile` — правила доступа

- `status !== 'active'` → нет.
- `user.role === 'admin'` (сверка с БД) → да, `cache: 'private'`. Это даёт админу и черновики.
- `course_cover` — нужен курс с `cover_file_id = file.id` и `status='published'`:
  - `visibility='public'` → да, `cache: 'public'`, в том числе гостю;
  - `internal` → пользователь в `organization_members` организации-владельца или есть
    любая строка `enrollments` на курс, `cache: 'private'`;
  - `private` → только при строке `enrollments`, `cache: 'private'`.
- `lesson_material`:
  - нужен вошедший пользователь;
  - в демо (`isDemo()`) — только admin (D-038): вошедший не-админ получает тот же 404, что без
    доступа, гость — вход;
  - уроки берутся по `lesson_files` с `status='published'`, они в одном курсе;
  - `loadCourseAccess(user.id, { id: courseId })` из `src/lib/learn/gate.ts` должен
    вернуть `status === 'ok'`;
  - хотя бы один из этих уроков есть в `progress.lessons` с `state !== 'locked'`.
  - Проверка зачисления, срока, отзыва, публикации курса и модуля и порядка прохождения
    берётся из учебного слоя — второй реализации нет. `cache: 'private'`.
- `submission` (#21) → пока `false`.

### 3.6. Маршруты

| Путь | Файл | Кто | Что |
|---|---|---|---|
| `POST /api/uploads?purpose=&courseId=&lessonId=` | `src/app/api/uploads/route.ts` | admin | `handleUpload(req, { getUser: getCurrentUser, clientIp: deriveClientIp })` |
| `GET /api/files/[id]` | `src/app/api/files/[id]/route.ts` | по `canReadFile` | `handleDownload` |
| `/[locale]/admin/courses/[id]/files` | `src/app/[locale]/admin/courses/[id]/files/page.tsx` | admin | список файлов курса, место, удаление |

- Оба route-файла: `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';`.
  Параметры — `{ params }: { params: Promise<{ id: string }> }` (Next 16).
- `src/proxy.ts` не меняется: matcher исключает `/api`, поэтому тело не буферизуется
  proxy (`proxyClientMaxBodySize` не участвует) и локаль не добавляется.
- `next.config.ts` **не меняется**: `serverActions.bodySizeLimit` остаётся 1 МБ.

**`handleUpload`:**
- **Запрос.** `Content-Type: application/octet-stream`. Заголовок `X-Upload-Name`
  обязателен: `encodeURIComponent(name)` ≤ 1024 символов; заголовки только ASCII.
- **Проверка источника** (`cross_site`, 403) — до чтения тела:
  - есть `Sec-Fetch-Site` — он должен быть `same-origin`;
  - иначе хост из `Origin` должен совпасть с `x-forwarded-host` (если есть) или с `host`.
  - Это вторая линия поверх cookie `sameSite=lax`. Свой заголовок `X-Upload-Name`
    вынуждает CORS preflight.
- **Тело** — `Readable.fromWeb(req.body)`.
- **Ответ:**
  - успех — `201 { ok: true, file: StoredFile }`;
  - отказ — `{ ok: false, error: UploadErrorCode, params? }` с HTTP-статусом из `UploadError`;
  - заголовки: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

**`handleDownload`:**
1. Флаг выключен → 404.
2. `id` не UUID → поведение «не найдено» (п. 5), без запроса в БД.
3. Лимит частоты: вошедший — на пользователя, гость — на IP. Превышение → 429.
4. Чтение строки `files`, затем `canReadFile`.
5. Нет доступа или файла:
   - **гость** → `302 /{locale}/login?next=/api/files/<id>`. Локаль — из cookie
     `NEXT_LOCALE`, по умолчанию `ru`; `next` проходит `safeNext`. Так же для
     несуществующего id — существование не раскрывается;
   - **вошедший** → `404 text/plain`.
6. `If-None-Match` равен `"<sha256>"` → 304 (доступ уже проверен).
7. `storage.open(key)`. Объекта нет → `console.error('[files] объект отсутствует', id)`,
   ответ 404.
8. 200, тело — поток. Заголовки:

| Заголовок | Значение |
|---|---|
| `Content-Type` | `files.mime` из БД (определён по сигнатуре) |
| `Content-Length` | `size_bytes` |
| `Content-Disposition` | `contentDisposition(kind, original_name)`: документы — `attachment`, изображения — `inline` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Referrer-Policy` | `no-referrer` |
| `ETag` | `"<sha256>"` |
| `Cache-Control` | `public`: `public, max-age=86400`; `private`: `private, no-cache` (каждый показ сверяет доступ, повтор — 304) |
| `Accept-Ranges` | `none` |

### 3.7. Контент урока: блоки `image` и `file` (зона foundation `src/lib/content`, правит исполнитель шага 1)

`src/lib/content/types.ts`:
```ts
export type ImageBlock = { id: string; type: 'image'; fileId: string; alt: string; caption?: string; width: number; height: number };
export type FileBlock = { id: string; type: 'file'; fileId: string; label?: string; name: string; ext: FileExt; sizeBytes: number };
export type Block = HeadingBlock | TextBlock | VideoBlock | CalloutBlock | DividerBlock | QuizBlock | ImageBlock | FileBlock;
```

`src/lib/content/blocks.ts`:
- `LIMITS.imageAlt = 300`, `LIMITS.fileLabel = 200`;
- `imageBlockSchema` — `fileId: z.string().uuid()`, `alt: min(1).max(300)`, `caption?`
  ≤ 500, `width`/`height` — int 1..20000;
- `fileBlockSchema` — `fileId` uuid, `label?` ≤ 200, `name` 1..160, `ext: z.enum([...6])`,
  `sizeBytes` int > 0;
- обе схемы — в `discriminatedUnion` и в `_SchemaTypeChecks`.
- `toPublicBlocks` пропускает их как есть: секретов нет, доступ проверяется при скачивании.

**Снимки** (`name`, `ext`, `sizeBytes`, `width`, `height`) редактор берёт из ответа загрузки,
но сервер при сохранении **всегда переписывает** их из `files` (`resolveLessonFiles`).
Значениям с клиента не верим.

**Ссылки в Markdown:**
- `FILE_URL_RE = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/gi`
  в `text.markdown`. Учитываются и `![…](…)`, и `[…](…)`, относительные и абсолютные адреса.
- Картинка `![…](/api/files/<id>)` требует `kind='image'`.
- Ссылка `[…](/api/files/<id>)` — любой вид.
- Ссылки на файлы чужого курса и удалённые файлы — ошибка сохранения `file_not_found`.

**Встраивание в `updateLesson`** (`src/lib/admin/lessons.ts`, внутри `db.tx` после
`FOR UPDATE` урока):
```ts
const { content: resolved, fileIds } = await resolveLessonFiles(sql, courseId, doc);
// … UPDATE lessons SET content = ${db.json(resolved)} …
await syncLessonFiles(sql, lessonId, fileIds);
```
В журнал `lesson.update` добавляется `files: fileIds.length`.

### 3.8. Интерфейс — файлы и компоненты (исполнитель B)

| Файл | Что |
|---|---|
| `src/components/admin/files/UploadButton.tsx` | клиент: `<input type=file accept>`, XHR на `/api/uploads` с прогрессом, разбор ошибки → текст из `files.errors.*`, предупреждение в демо |
| `src/components/admin/files/CoverCard.tsx` | обложка курса: превью 16:9, «Загрузить», «Заменить», «Убрать обложку» |
| `src/components/admin/files/CourseFilesTable.tsx` | таблица файлов курса: имя, тип, размер, кто и когда, где используется, «Удалить» для неиспользуемых |
| `src/components/admin/lesson/ImageEditor.tsx`, `FileEditor.tsx` | редакторы блоков |
| `src/components/admin/lesson/BlockListEditor.tsx` | кнопки «Изображение» и «Файл» (только при `uploadsEnabled`), ветки `image`/`file` в `BlockBody` |
| `src/components/admin/lesson/BlockEditors.tsx` | в `TextEditor` — «Вставить картинку»: загрузка → вставка `![](/api/files/<id>)` в позицию курсора |
| `src/components/admin/lesson/BlockPreview.tsx` | превью `image`/`file` |
| `src/components/admin/lesson/blockModel.ts` | `newImageBlock(f: StoredFile)`, `newFileBlock(f)`, ветки в `normalizeBlocks` (trim alt/caption/label) |
| `src/components/admin/lesson/LessonEditor.tsx` | проп `uploads: { enabled: boolean; courseId: string; lessonId: string; limits: { image: number; document: number }; demo: boolean }` |
| `src/components/admin/lesson/issueText.ts` | коды `file_not_found`, `file_wrong_kind` |
| `src/app/[locale]/admin/courses/[id]/lessons/[lessonId]/page.tsx` | передаёт `uploads` в редактор |
| `src/app/[locale]/admin/courses/[id]/page.tsx` | `CoverCard` и ссылка «Файлы курса» при включённом флаге |
| `src/app/[locale]/admin/courses/[id]/files/page.tsx` | новая страница; при выключенном флаге — `notFound()` |
| `src/components/learn/ImageBlock.tsx`, `FileBlock.tsx` | показ слушателю |
| `src/components/learn/Blocks.tsx` | ветки `image`/`file`, при выключенном флаге — `null` |
| `src/components/learn/Markdown.tsx` | проп `filesEnabled`: при `false` `img` с `/api/files/` не выводится |
| `messages/{ru,kz}/files.json` | тексты (раздел 4) |
| `messages/{ru,kz}/admin.json` | `lessonEditor.blocks.types.{image,file}`, `lessonEditor.issue.{fileNotFound,fileWrongKind}`, `errors.{FEATURE_DISABLED,FILE_IN_USE,FILE_NOT_FOUND}` |

`src/lib/i18n/request.ts`: в `NAMESPACES` добавить `'files'` (шаг 1).

---

## 4. Сценарии, экраны, локали

**Админ, урок** (`/admin/courses/[id]/lessons/[lessonId]`):
1. «Добавить блок» → «Изображение» открывает выбор файла (PNG, JPEG, WebP).
   - Идёт загрузка: «Загрузка… 42 %».
   - Готово: блок появляется в конце списка с превью, полем «Текст вместо изображения»
     (обязательное) и «Подпись».
2. «Файл» загружается так же (PDF, DOCX, XLSX, PNG, JPEG, WebP). Карточка блока:
   - имя, тип и размер;
   - поле «Название для слушателя» (пусто — имя файла).
3. В текстовом блоке «Вставить картинку» вставляет в Markdown `![](/api/files/<id>)`.
   Предпросмотр показывает картинку.
4. Ошибка — текст под кнопкой, блок не создаётся: «Файл больше 25 МБ», «Этот тип файла
   не поддерживается…».
5. Файлы попадают в урок только после «Сохранить». Незакреплённые удаляются через сутки.
6. В демо над кнопками — предупреждение о ПДн.

**Админ, курс** (`/admin/courses/[id]`): карточка «Обложка».
- Пусто: «Обложки нет — в каталоге показывается цветная панель». Кнопка «Загрузить обложку».
- Есть: превью 16:9, кнопки «Заменить» и «Убрать обложку».
- Загрузка вызывает `setCourseCoverAction` сразу.
- Ссылка «Файлы курса».

**Админ, файлы курса** (`/admin/courses/[id]/files`):
- таблица: имя, тип, размер, загрузил, дата, где используется (уроки ссылками,
  «обложка»);
- «Удалить» — только у неиспользуемых, с подтверждением;
- сверху «Занято 1,2 ГБ из 2 ГБ».

**Слушатель, урок:**
- изображение — `<figure>` с `<img width height loading="lazy" alt>` и подписью;
- файл — плоская карточка-«бумага»: иконка `FileText` или `FileSpreadsheet`, название,
  «PDF · 2,4 МБ», кнопка «Скачать» (`<a href download>`);
- без анимаций и теней, как в BRAND «Без ИИ-шума».

**Гость, каталог:** обложка опубликованного public-курса видна. Обложки черновиков и
закрытых курсов отдаются 302 на вход.

**Ключи `messages/{ru,kz}/files.json`** (kz — «требует проверки носителем», #13):

| Ключ | ru | kz |
|---|---|---|
| `upload.image` | Загрузить изображение | Суретті жүктеу |
| `upload.file` | Загрузить файл | Файлды жүктеу |
| `upload.replace` | Заменить | Ауыстыру |
| `upload.progress` | Загрузка… {percent} % | Жүктелуде… {percent} % |
| `upload.hintImage` | PNG, JPEG или WebP, до {size} | PNG, JPEG немесе WebP, {size} дейін |
| `upload.hintFile` | PDF, DOCX, XLSX или изображение, до {size} | PDF, DOCX, XLSX немесе сурет, {size} дейін |
| `upload.hintCover` | PNG, JPEG или WebP, не меньше 800×450, до {size}. Пропорции 16:9 | PNG, JPEG немесе WebP, кемінде 800×450, {size} дейін. Арақатынасы 16:9 |
| `upload.demoWarning` | Демо-версия: файлы хранятся временно и не в Казахстане. Не загружайте документы с персональными данными. | Демо-нұсқа: файлдар уақытша және Қазақстаннан тыс сақталады. Дербес деректері бар құжаттарды жүктемеңіз. |
| `errors.disabled` | Загрузка файлов выключена. | Файл жүктеу өшірулі. |
| `errors.forbidden` | Нет прав на загрузку. | Жүктеуге құқық жоқ. |
| `errors.not_found` | Курс или урок не найден. | Курс немесе сабақ табылмады. |
| `errors.bad_request` | Не удалось прочитать файл. Выберите его ещё раз. | Файлды оқу мүмкін болмады. Қайта таңдаңыз. |
| `errors.cross_site` | Запрос отклонён. Обновите страницу. | Сұрау қабылданбады. Бетті жаңартыңыз. |
| `errors.length_required` | Не удалось определить размер файла. | Файл көлемін анықтау мүмкін болмады. |
| `errors.too_large` | Файл больше {size}. | Файл {size} артық. |
| `errors.empty` | Файл пустой. | Файл бос. |
| `errors.bad_type` | Этот тип файла не поддерживается. Подходят: {types}. | Бұл файл түрі қолданылмайды. Жарамды түрлер: {types}. |
| `errors.macro` | Файлы с макросами не принимаются. Сохраните документ как DOCX или XLSX без макросов. | Макросы бар файлдар қабылданбайды. Құжатты макроссыз DOCX немесе XLSX ретінде сақтаңыз. |
| `errors.image_too_large` | Изображение больше {max} пикселей по стороне. Уменьшите его. | Сурет бір жағынан {max} пиксельден үлкен. Кішірейтіңіз. |
| `errors.image_too_small` | Обложка должна быть не меньше 800×450. | Мұқаба кемінде 800×450 болуы керек. |
| `errors.quota` | Место для файлов закончилось. Удалите неиспользуемые файлы курса. | Файлдарға арналған орын бітті. Курстың қолданылмайтын файлдарын өшіріңіз. |
| `errors.rate_limited` | Слишком много загрузок подряд. Повторите через несколько минут. | Жүктеу тым көп. Бірнеше минуттан кейін қайталаңыз. |
| `errors.busy` | Дождитесь окончания текущих загрузок. | Ағымдағы жүктеулердің аяқталуын күтіңіз. |
| `errors.storage_unavailable` | Хранилище файлов недоступно. Сообщите администратору сервера. | Файл қоймасы қолжетімсіз. Сервер әкімшісіне хабарлаңыз. |
| `errors.generic` | Не удалось загрузить файл. Повторите попытку. | Файлды жүктеу мүмкін болмады. Қайталап көріңіз. |
| `image.alt` | Текст вместо изображения | Сурет орнындағы мәтін |
| `image.altHint` | Что на изображении. Его читает экранный диктор. | Суретте не бар. Оны экрандық диктор оқиды. |
| `image.caption` | Подпись | Жазу |
| `file.label` | Название для слушателя | Тыңдаушыға арналған атау |
| `file.labelHint` | Если пусто — имя файла. | Бос болса — файл атауы. |
| `file.meta` | {type} · {size} | {type} · {size} |
| `file.download` | Скачать | Жүктеп алу |
| `markdown.insertImage` | Вставить картинку | Сурет кірістіру |
| `cover.title` | Обложка | Мұқаба |
| `cover.empty` | Обложки нет — в каталоге показывается цветная панель. | Мұқаба жоқ — каталогта түсті панель көрсетіледі. |
| `cover.upload` | Загрузить обложку | Мұқабаны жүктеу |
| `cover.remove` | Убрать обложку | Мұқабаны алып тастау |
| `cover.saved` | Обложка сохранена. | Мұқаба сақталды. |
| `library.title` | Файлы курса | Курс файлдары |
| `library.link` | Файлы курса | Курс файлдары |
| `library.usage` | Занято {used} из {total} | {total} ішінен {used} пайдаланылды |
| `library.empty` | Файлов пока нет. | Әзірге файл жоқ. |
| `library.columns.name` | Файл | Файл |
| `library.columns.type` | Тип | Түрі |
| `library.columns.size` | Размер | Көлемі |
| `library.columns.uploaded` | Загружен | Жүктелді |
| `library.columns.usage` | Где используется | Қай жерде қолданылады |
| `library.cover` | Обложка курса | Курс мұқабасы |
| `library.unused` | Не используется | Қолданылмайды |
| `library.delete` | Удалить | Өшіру |
| `library.deleteConfirm` | Удалить файл? Восстановить его будет нельзя. | Файлды өшіру керек пе? Оны қалпына келтіру мүмкін болмайды. |
| `library.inUse` | Файл используется. Сначала уберите его из уроков. | Файл қолданылуда. Алдымен оны сабақтардан алып тастаңыз. |
| `units.b` / `units.kb` / `units.mb` / `units.gb` | Б / КБ / МБ / ГБ | Б / КБ / МБ / ГБ |

В `admin.json` (ru / kz):
- `lessonEditor.blocks.types.image`: «Изображение» / «Сурет»;
- `lessonEditor.blocks.types.file`: «Файл» / «Файл»;
- `lessonEditor.issue.fileNotFound`: «Файл не найден или удалён. Загрузите его заново.» /
  «Файл табылмады немесе өшірілген. Қайта жүктеңіз.»;
- `lessonEditor.issue.fileWrongKind`: «Здесь нужна картинка (PNG, JPEG, WebP).» /
  «Мұнда сурет керек (PNG, JPEG, WebP).»;
- `errors.FEATURE_DISABLED`: «Функция выключена.» / «Функция өшірулі.»;
- `errors.FILE_IN_USE`: «Файл используется в уроках или как обложка.» /
  «Файл сабақтарда немесе мұқаба ретінде қолданылады.»;
- `errors.FILE_NOT_FOUND`: «Файл не найден.» / «Файл табылмады.»

Тон — по BRAND: факты, без «→» и восклицаний. Новые строки проходят тесты
`*-no-slop`.

---

## 5. Безопасность и угрозы

| # | Угроза | Как закрыто |
|---|---|---|
| 1 | Хранимый XSS: HTML или SVG с того же origin | Белый список по сигнатуре: SVG и HTML не принимаются. `Content-Type` только из БД. `nosniff`. CSP `sandbox; default-src 'none'`. Документы — `attachment` |
| 2 | Полиглоты (PDF+HTML, ZIP+JS) | PDF строго с нулевого байта. `nosniff`, `attachment`, `sandbox`. Тип не зависит от расширения |
| 3 | Path traversal через имя или ключ | Имя пользователя никогда не попадает в путь. Ключ генерирует сервер и проверяет регулярным выражением. `resolve` внутри корня. Проверка симлинка `objects/`. Временные файлы — `wx` |
| 4 | Подбор id, раскрытие существования | UUID v4. Гостю на любой id — 302 на вход, вошедшему — 404. Лимиты частоты выдачи |
| 5 | Утечка платного материала | Доступ на каждый запрос через `loadCourseAccess` (зачисление, срок, отзыв, публикация, порядок). Учитываются только ссылки опубликованных уроков. `private, no-cache` с ETag: после отзыва доступа повтор из кеша получает 404 |
| 6 | Черновики видны слушателям | Файл черновика урока не попадает в доступ слушателя, пока опубликованный урок на него не ссылается. Обложка черновика курса — только админу |
| 7 | CSRF на загрузку | Cookie `sameSite=lax`. Проверка `Sec-Fetch-Site`/`Origin` до чтения тела. Свой заголовок вынуждает preflight. Удаление и обложка — server actions со встроенной проверкой Origin в Next |
| 8 | DoS: большие тела, заполнение диска | Проверка `Content-Length` до чтения. Обрыв потока при превышении. Лимиты частоты и одновременных загрузок. Порог свободного места. Квоты: общая и на курс, точная проверка под advisory-блокировкой. Nginx `client_max_body_size 30m` только на `/api/uploads` (#24). Server actions остаются с 1 МБ |
| 9 | Пиксельная бомба | Размеры читаются из заголовка без декодирования. Лимиты стороны и числа пикселей |
| 10 | ZIP-бомба | ZIP не распаковывается. Читается только центральный каталог (лимит записей и размера). `[Content_Types].xml` распаковывается с `maxOutputLength` 1 МБ |
| 11 | Макросы, ActiveX | `vbaProject.bin`, `activeX/`, `macroEnabled` → отказ `macro`. Старые DOC/XLS (CFB) не принимаются |
| 12 | Вредоносные документы | MVP: загружает только admin. Антивирус (ClamAV на сервере) — вопрос владельцу, обязателен до #21 |
| 13 | ПДн в EXIF (GPS, автор) | `stripImageMetadata` для JPEG (APP1/APP13), PNG (`eXIf`, `tEXt`, `iTXt`, `zTXt`), WebP (`EXIF`, `XMP `) без перекодирования |
| 14 | Подмена через имя файла: RTLO, `"`, CR/LF в заголовке | `sanitizeFileName`, расширение по сигнатуре, RFC 5987, ASCII-заголовок |
| 15 | ПДн за рубежом (D-009) | Провайдер `local` на сервере ЦРП в РК. `s3` только после решения ЦРП и только в РК. В демо — предупреждение не загружать ПДн. Внешних вызовов нет |
| 16 | Хотлинк и встраивание чужими сайтами | `Cross-Origin-Resource-Policy: same-origin`, `frame-ancestors 'none'` |
| 17 | Гонка «подметание ↔ сохранение урока» | Сохранение берёт `FOR SHARE` на строки `files`. Подметание: кандидаты → `FOR UPDATE` строки → **новым запросом** перепроверка ссылок → `status='deleted'` → коммит → удаление объекта. Тест на Postgres |
| 18 | Потеря файлов при деплое | `STORAGE_DIR` вне каталога приложения. Иначе `inside_app_dir`, хранилище недоступно (fail closed). Каталог входит в ежедневный бэкап (#24) |
| 19 | Мусор и рассинхрон хранилища с БД | `sweepOrphanFiles` — неиспользуемые старше 24 ч. `sweepStrayObjects` — объекты без активной строки старше 1 ч. `sweepTemp` — `.tmp` старше 1 ч |
| 20 | Повышение прав | `assertAdmin` сверяет роль с БД на каждой загрузке и каждом действии. Слушатель не загружает ничего, пока нет #21 |
| 21 | Логи с ПДн | В журнал и консоль — id, тип, размер. Имя файла хранится только в `files` (`original_name`) и в журнал не пишется. Для #21 имена не журналируются |
| 22 | Тихое демо в проде | В production без `STORAGE_DIR` хранилище `not_configured` → загрузка 503, `tmpdir` не подставляется. Флаг в production по умолчанию выключен |

**Журнал (`audit_log`):**
- `file.upload` (entity `file`);
- `file.delete` — удалил админ;
- `file.purge` — подметание, `actor_id` NULL, meta `{ reason: 'orphan' }`;
- `course.cover_set` и `course.cover_clear` (entity `course`, meta `{ fileId }`);
- `lesson.update` — плюс `files`.

Скачивания не журналируются: объём и шум.

---

## 6. Флаг и демо

**Флаг `UPLOADS`** (`isFeatureEnabled('UPLOADS')`):
- в production по умолчанию выключен, `FEATURE_UPLOADS=1` включает;
- в демо по умолчанию включён, `FEATURE_UPLOADS=0` выключает.

Выключенный флаг гасит функцию так:

| Где | Поведение |
|---|---|
| `POST /api/uploads` | 404 до чтения тела и проверки сессии |
| `GET /api/files/[id]` | 404 для всех, включая админа. Это аварийный выключатель |
| `/[locale]/admin/courses/[id]/files` | `notFound()` |
| Редактор урока | кнопок «Изображение», «Файл», «Вставить картинку» нет. Существующие блоки `image`/`file` показываются карточкой без превью и сохраняются как есть, ссылки проверяются в БД |
| Страница курса в админке | нет карточки «Обложка» и ссылки «Файлы курса» |
| Server actions `setCourseCoverAction`, `clearCourseCoverAction`, `deleteFileAction` | `AdminError('FEATURE_DISABLED')` → `{ ok: false, error: 'FEATURE_DISABLED' }` |
| Урок слушателя | блоки `image`/`file` → `null`. Картинки Markdown с `/api/files/` не выводятся |
| Витрина | `CourseCover` получает `cover`. Адрес `/api/files/…` вернёт 404 и сломает картинку. Поэтому запросы каталога и обучения отдают `cover = null`, если флаг выключен и `cover` начинается с `/api/files/` (одна функция `visibleCover(cover)` в `src/lib/files/url.ts`; catalog и learn вызывают её — правка в их зонах, шаг 2B) |
| Подметание (`scripts/files-sweep.ts`) | работает независимо от флага: только удаляет |

**Без хранилища** (флаг включён, `storageConfig().ok === false`):
- загрузка → 503 `storage_unavailable`;
- админка показывает `errors.storage_unavailable` вместо кнопок;
- выдача → 404 и `console.error` один раз на процесс.

**Демо (PGlite в памяти, Vercel или Netlify без постоянного диска):**
- **Каталог.** Без `STORAGE_DIR` — `os.tmpdir()/crp-demo-files`: на Vercel и Netlify
  `/tmp` доступен на запись. Объекты живут столько же, сколько экземпляр с PGlite в
  памяти. Новый экземпляр приходит без строк `files` и без объектов — рассинхрона нет.
  Если запрос попал на другой экземпляр, строки там тоже нет → 404 или вход, как для
  остальных демо-данных («данные сбрасываются»).
- **`PGLITE_DIR` без `STORAGE_DIR`.** Строки переживают перезапуск, объекты из
  `tmpdir` могут пропасть → 404 и лог. В `.env.example` — подсказка задать
  `STORAGE_DIR` рядом с `PGLITE_DIR`.
- **Лимит.** На Vercel и Netlify (`serverless`) — 4 МБ на любой файл: Vercel режет тело
  на 4,5 МБ, и человек должен увидеть наш понятный отказ, а не 413 площадки. Подсказки
  в интерфейсе показывают действующий лимит: сервер передаёт `limits` в редактор.
- **ПДн.** Предупреждение `upload.demoWarning` у каждой кнопки загрузки при `isDemo()`.
- **Выдача (D-038).** Материал урока, загруженный в демо, выдаётся только администратору;
  слушатель видит подпись вместо него, картинки в тексте урока не рисуются. Обложки — как вне демо.
- **Сид.** Файлов и обложек в сиде нет: обложки демо-курсов — панели тона, как сейчас.
- **E2E** (`next start`, `DEMO_MODE=1`): файлы во временном каталоге раннера.

**Переменные** (`.env.example`, правит оркестратор):
```
# Загрузка файлов (флаг FEATURE_UPLOADS). Каталог файлов на сервере ЦРП: абсолютный путь вне
# каталога приложения, в бэкапе. Пусто: в демо — временный каталог, вне демо — загрузка недоступна.
STORAGE_DIR=
# local (по умолчанию). s3 — после решения ЦРП (хранилище в РК), пока не реализован.
STORAGE_PROVIDER=
# Квоты, байт: всего и на курс (по умолчанию 20 ГБ и 2 ГБ).
UPLOAD_QUOTA_BYTES=
UPLOAD_COURSE_QUOTA_BYTES=
FEATURE_UPLOADS=
```

**Эксплуатация (#24, не код):**
- `STORAGE_DIR=/var/lib/crp/files`, владелец — пользователь приложения, права `0700`;
- каталог входит в ежедневный бэкап;
- Nginx: `location /api/uploads { client_max_body_size 30m; proxy_request_buffering off; }`;
- crontab: ежедневно `npx tsx scripts/files-sweep.ts`.

---

## 7. Тесты

### Unit (`tests/unit/*.test.ts`, без БД)

`files-sniff.test.ts`:
- PNG, JPEG (baseline и progressive), WebP (VP8, VP8L, VP8X) — тип и размеры;
- PDF;
- DOCX и XLSX из мини-ZIP, его собирает тестовый помощник (stored, без сжатия, и
  deflate для `[Content_Types].xml`);
- `bad_type`:
  - SVG; HTML с расширением `.png`; GIF; CFB `D0CF11E0`;
  - ZIP без `word/` и `xl/`; ZIP с обоими;
  - PDF с мусором перед `%PDF`; пустой и обрезанный файл;
- `macro`: `vbaProject.bin`, `macroEnabled` в `[Content_Types].xml`, `activeX/`;
- `corrupt`: ZIP с `../` в имени, ZIP64-маркеры, записей больше лимита;
- JPEG без SOF; WebP с битым размером.

`files-strip-meta.test.ts`:
- из JPEG с EXIF (GPS) и XMP пропадают APP1 и APP13, SOS и пиксельные данные
  побайтно равны исходным;
- из PNG пропадают `tEXt`, `iTXt`, `zTXt`, `eXIf`, IHDR и IDAT не изменены, CRC корректны;
- из WebP пропадают `EXIF` и `XMP `, флаги VP8X сброшены, размер RIFF пересчитан.

`files-names.test.ts`:
- `sanitizeFileName`: RTLO, `../../etc/passwd`, `C:\x\y.pdf`, управляющие символы,
  кавычки, 300 символов, пустое имя, двойное расширение;
- `contentDisposition`: кириллица → `filename*`, ASCII-запасное имя, без CR/LF,
  `attachment` или `inline` по виду.

`files-storage-key.test.ts`:
- `assertStorageKey` отклоняет `../x`, `/abs`, `ab/../../x`, `AB/…`, пустую строку, NUL;
- `newStorageKey` проходит проверку.

`files-config.test.ts` (`storageConfig`, переменные окружения подменяются в тесте):
- демо без `STORAGE_DIR` → `tmpdir`;
- production без `STORAGE_DIR` → `not_configured`;
- относительный путь → `relative_path`;
- путь внутри `cwd` → `inside_app_dir`;
- `s3` → `provider_not_implemented`;
- `VERCEL=1` → `maxBytesFor` = 4 МБ.

`files-refs.test.ts` (`collectFileRefs`):
- блоки `image` и `file`;
- Markdown: картинка, ссылка, абсолютный URL, `?x=1`, несколько ссылок в строке;
- id с лишними символами не совпадает;
- ссылки в kz;
- дубликаты.

`core-blocks.test.ts` (дополнить):
- схемы `image` и `file`: `alt` обязателен, `fileId` — UUID, `ext` из списка;
- `toPublicBlocks` пропускает блоки без изменений.

`files-http-headers.test.ts` — `handleDownload` с заглушками БД и хранилища, проверка
заголовков:
- `nosniff`, CSP, CORP;
- `attachment` для PDF, `inline` для PNG;
- `Content-Type` из строки, а не из имени;
- 304 по `If-None-Match`.

`i18n-parity.test.ts` подхватит `files.json` сам. `*-no-slop` — новые строки.

### Интеграционные (`tests/integration/*.test.ts`)

PGlite и Postgres 16 (`TEST_DATABASE_URL`). Хранилище — `mkdtemp`, `STORAGE_DIR`
подменяется в тесте.

`files-upload.test.ts` (`storeUpload`):
- админ загружает PNG → строка `files`, объект в `objects/`, журнал `file.upload`,
  EXIF удалён, `sha256` совпадает с сохранёнными байтами;
- не админ и пониженный админ (роль сменилась в БД) → `forbidden`;
- урок другого курса → `not_found`;
- реальный размер больше `declaredSize` → `too_large`, временный файл удалён, строки нет;
- cover 600×400 → `image_too_small`; cover PDF → `bad_type`;
- квота курса исчерпана → `quota`, объект удалён;
- флаг выключен → `disabled`;
- без `STORAGE_DIR` в production-режиме → `storage_unavailable`.

`files-lesson-refs.test.ts` (`updateLesson`):
- сохранение с `image`, `file` и Markdown-ссылкой → `lesson_files` из трёх id, снимки
  переписаны из БД (подменённые клиентом `sizeBytes` и `name` не сохраняются);
- ссылка на файл другого курса или удалённый файл → `VALIDATION` с issue
  `file_not_found` и путём к блоку;
- картинка Markdown на PDF → `file_wrong_kind`;
- удаление блока → строка `lesson_files` исчезает;
- kz-копия блоков → одна строка на файл.

`files-access.test.ts` (`canReadFile`), матрица:
- админ — черновик курса и черновик урока: да;
- зачисленный — опубликованный урок: да;
- не зачисленный, истёкший, отозванный: нет;
- файл есть только в черновике урока: нет;
- урок закрыт порядком (`sequential`): нет;
- файл не используется: нет;
- `status='deleted'`: нет;
- обложка public опубликованного курса — гость: да (`public`);
- обложка черновика курса — гость: нет;
- обложка internal — член организации: да; чужой: нет;
- обложка private — зачисленный: да;
- после `revokeEnrollment`: нет;
- демо (D-038): материал урока — зачисленный с доступом: нет (404); админ: да; гость: вход;
  обложка public опубликованного курса — гость: да.

`files-download.test.ts` (`handleDownload` на реальной БД и хранилище):
- гость → 302 на `/ru/login?next=%2Fapi%2Ffiles%2F<id>`, для несуществующего id — так же;
- вошедший без доступа → 404, без доступа к несуществующему → 404 (одинаково);
- объект пропал → 404;
- флаг выключен → 404.

`files-upload-http.test.ts` (`handleUpload`):
- `Sec-Fetch-Site: cross-site` → 403 без чтения тела (поток-ловушка бросает при чтении);
- нет `Content-Length` → 411;
- `Content-Length` больше лимита → 413 без чтения тела;
- некорректный `X-Upload-Name` → 400;
- лимит частоты → 429.

`files-admin.test.ts`:
- `setCourseCover` пишет `cover` и `cover_file_id` вместе, журнал;
- чужой курс или не cover → `VALIDATION`;
- `clearCourseCover`;
- `deleteFile` используемого → `FILE_IN_USE`, неиспользуемого → `deleted`, объект удалён;
- `listCourseFiles` показывает использование.

`files-sweep.test.ts`:
- сирота старше 24 ч → `deleted` и объект удалён, журнал `file.purge`;
- младше 24 ч, используемый уроком, текущая обложка — не трогаются;
- после `deleteLesson` файл становится сиротой;
- `sweepStrayObjects` удаляет объект без строки старше 1 ч;
- `sweepTemp`;
- `dryRun` ничего не меняет.

`files-sweep-race.test.ts` — только Postgres, пропуск без `TEST_DATABASE_URL`:
параллельно `updateLesson` со ссылкой на старый неиспользуемый файл и
`sweepOrphanFiles`. Возможны два исхода, третьего быть не должно:
- урок сохранён и файл `active`;
- урок отклонён (`file_not_found`) и файл `deleted`.

Ссылки на удалённый файл не бывает никогда. Плюс параллельные загрузки у границы
квоты: сумма не превышает квоту.

`core-migrations.test.ts` уже прогоняет миграции дважды — новая миграция должна пройти.

### E2E (`tests/e2e/uploads.spec.ts`, демо, флаг по умолчанию включён)

Файлы-фикстуры создаются в тесте буферами (`setInputFiles({ name, mimeType, buffer })`).

1. **Админ** (`admin@crp.demo`):
   - урок «Целины» → «Изображение» → PNG → ввести текст вместо изображения → «Файл» →
     PDF → «Сохранить»;
   - в превью видна картинка;
   - карточка файла показывает «PDF · …».
2. **Клиент** (`client@crp.demo`, зачислен на «Целину»), тот же урок. В демо по D-038 материал
   урока, загруженный через `/api/uploads`, клиенту не выдаётся: вместо картинки и ссылки —
   нейтральная подпись, `/api/files/<id>` → 404. Вне демо (интеграционный тест или e2e с
   отдельной конфигурацией):
   - `img` загружена: ответ `/api/files/<id>` 200, `image/png`, `nosniff`;
   - «Скачать» запускает загрузку с именем `*.pdf`.
3. **Гость:** `request.get('/api/files/<id>')` без cookie → 302 на `/ru/login`.
4. **Оператор** (`operator@crp.demo`, не зачислен на «Целину») → 404.
5. **Админ, ошибка типа:** файл `fake.png` с содержимым `<html>` → видна ошибка
   «Этот тип файла не поддерживается…», блок не добавлен.
6. **Админ, обложка:** курс → «Загрузить обложку» 1200×675 → в каталоге у гостя
   карточка курса с `img` из `/api/files/…`.

---

## 8. План реализации

Конфликтов нет, потому что зоны не пересекаются. Шаг 1 — короткий общий контракт,
он вливается до начала шагов 2A и 2B.

**Шаг 0** — оркестратор (T1, сам или `mechanic` T0 для `.env.example`); ревью — `reviewer` (T2):
- D-034 в `DECISIONS.md`;
- правки `docs/lms/BUILD.md` (§3, §6, §8, §12);
- `.env.example`;
- комментарий в #8.

**Шаг 1** — контракт, `builder` (T1), один исполнитель:
1. `migrations/2026-10-20-uploads.sql` (текст из §2).
2. `src/lib/content/types.ts` и `blocks.ts`: `ImageBlock`, `FileBlock`, схемы, `LIMITS`.
3. Заглушки веток `image`/`file` во всех `switch` по `block.type` (возврат `null` или
   блок как есть), чтобы `tsc` был зелёным:
   - `src/components/admin/lesson/{BlockListEditor,BlockPreview}.tsx`;
   - `blockModel.ts` (`normalizeBlocks`);
   - `src/components/learn/Blocks.tsx`.
4. Общие типы и константы:
   - `src/lib/storage/limits.ts`;
   - `src/lib/files/types.ts`, `src/lib/files/url.ts` (`fileUrl`, `FILE_URL_RE`,
     `isUuid`, `visibleCover`).
5. `src/lib/admin/errors.ts`: три новых кода.
6. `src/lib/i18n/request.ts`: `'files'` в `NAMESPACES`. Пустые
   `messages/{ru,kz}/files.json` (`{}`).
7. `src/lib/features.ts`, если его ещё нет (контракт §3.1).
8. Тесты: `core-blocks` (новые схемы), прогон `core-migrations`.

Проверки: `typecheck`, `lint`, `test:unit`, `test:integration`. Ревью — `reviewer`
(миграция — T2).

**Шаг 2A** — сервер, `builder` (T2→T1). Зона:
- `src/lib/storage/**`, `src/lib/files/**`;
- `src/app/api/uploads/route.ts`, `src/app/api/files/[id]/route.ts`;
- `scripts/files-sweep.ts`;
- `src/lib/admin/lessons.ts` (только встраивание `resolveLessonFiles`/`syncLessonFiles`);
- тесты `tests/unit/files-*.test.ts`, `tests/integration/files-*.test.ts`, тестовый
  помощник `tests/helpers/fileFixtures.ts` (PNG, JPEG с EXIF, WebP, PDF, мини-ZIP).

Порядок:
1. `names.ts`, `sniff.ts`, `ooxml.ts`, `stripMeta.ts` + unit-тесты.
2. `config.ts`, `local.ts`, `index.ts` + unit-тесты.
3. `store.ts`, `limits.ts` + `files-upload`.
4. `refs.ts` + встраивание в `updateLesson` + `files-lesson-refs`.
5. `access.ts` + `files-access`.
6. `http.ts` и route-файлы + `files-download`, `files-upload-http`, `files-http-headers`.
7. `admin.ts`, `actions.ts` + `files-admin`.
8. `sweep.ts`, скрипт + `files-sweep`, `files-sweep-race`.

**Шаг 2B** — интерфейс, `builder` (T1). Параллельно с 2A, работает по контракту §3.3:
до слияния 2A сигнатуры `storeUpload`/`actions` уже известны. Зона:
- `src/components/admin/files/**`, `src/components/admin/lesson/**`;
- `src/app/[locale]/admin/courses/[id]/page.tsx`,
  `.../lessons/[lessonId]/page.tsx`, `.../files/page.tsx`;
- `src/components/learn/{ImageBlock,FileBlock,Blocks,Markdown}.tsx`;
- `messages/{ru,kz}/files.json`, ключи в `messages/{ru,kz}/admin.json`;
- точечно: `visibleCover` в `src/lib/catalog/queries.ts` и `src/lib/learn/data.ts`
  (по одной строке; согласовать с владельцами зон в issue);
- `tests/e2e/uploads.spec.ts`.

Порядок:
1. Тексты.
2. `UploadButton`.
3. `ImageEditor`, `FileEditor`, ветки списка и превью.
4. «Вставить картинку».
5. `CoverCard`, страница файлов.
6. Показ слушателю.
7. `visibleCover`.
8. e2e — после слияния 2A.

**Шаг 3** — проверки:
- `tester` (T1): полный прогон, включая интеграционные на Postgres 16 и e2e;
- `reviewer` (T2, Opus): безопасность по §5. Отдельно — заголовки выдачи, гонка
  подметания, путь к файлу, проверка источника загрузки, отсутствие утечки
  `correct`/`explain` (контент уроков не менялся).

**Шаг 4** — эксплуатация (#24, вне кода): `STORAGE_DIR`, бэкап, Nginx, crontab
подметания. Включение `FEATURE_UPLOADS=1` в проде — после приёмки владельцем.

---

## 9. Вопросы владельцу (с рекомендуемым ответом)

1. **Кто загружает файлы в MVP?**
   Рекомендую: только администратор. Роль «автор» и модерация — позже, вместе с SPEC §1 `[дозаполни]`.
2. **Лимиты и квоты.**
   Рекомендую:
   - изображение до 5 МБ, документ до 25 МБ;
   - всего 20 ГБ, на курс 2 ГБ.

   Сверить с диском сервера ЦРП (#24) и размером реальных материалов «Целины».
3. **Форматы.**
   Рекомендую:
   - добавить PPTX: материалы консалтинга часто в презентациях, это одна строка
     в `FILE_TYPES` и проверка `ppt/presentation.xml`;
   - старые DOC/XLS/PPT не принимать: просить сохранить в новом формате.
4. **PDF: только скачивание или просмотр в браузере?**
   Рекомендую: только скачивание. Встроенный просмотр с нашего домена — лишний риск,
   а со слоем `sandbox` он не работает в Chrome.
5. **Антивирус.**
   Рекомендую: ClamAV (clamd) на сервере ЦРП. Для загрузок админа — желательно,
   до практических заданий (#21, загружают слушатели) — обязательно. Внешние сканеры
   (VirusTotal и т. п.) не использовать: это передача файлов за рубеж.
6. **S3-совместимое хранилище в РК.**
   Рекомендую: на старте локальный диск сервера ЦРП с ежедневным бэкапом. Провайдера
   S3 в РК выбирать, когда объём превысит диск или понадобится второй сервер. Выбор —
   за ЦРП (договор, D-009).
7. **Демо на Vercel.** Решено в D-038: загрузки включены, материал урока видит только админ.
   Исходная рекомендация: загрузки включены с лимитом 4 МБ и предупреждением «не загружайте
   ПДн». Альтернатива — выключить в демо (`FEATURE_UPLOADS=0`), но тогда владелец не
   проверит функцию по ссылке.
8. **Срок хранения удалённых файлов.**
   Рекомендую: объект удаляется сразу при подметании, строка остаётся для журнала.
   Восстановление — из ежедневного бэкапа `STORAGE_DIR`.
