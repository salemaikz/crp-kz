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
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),   -- файл ≤ 25 МБ; не BIGINT: правило снимка демо (BIGINT — только *_at, *_kzt)
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
-- Индексы под внешние ключи: SET NULL при удалении урока или пользователя иначе сканирует files.
CREATE INDEX IF NOT EXISTS files_lesson_idx ON files (lesson_id);
CREATE INDEX IF NOT EXISTS files_uploaded_by_idx ON files (uploaded_by);

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
