-- Юридические документы и согласия (#17). Нормативно: docs/lms/BUILD.md §3, DECISIONS D-035.
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
-- Внешний ключ text_sha256: без индекса проверка RESTRICT при удалении текста сканирует consents.
CREATE INDEX IF NOT EXISTS consents_text_sha256_idx ON consents (text_sha256);

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

-- Согласие, привязанное к тексту, обязано знать язык и контекст (иначе по хэшу не восстановить,
-- что и где видел человек). Старые строки (text_sha256 IS NULL) ограничение не затрагивает.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'consents_text_context_check' AND t.relname = 'consents' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE consents ADD CONSTRAINT consents_text_context_check
      CHECK (text_sha256 IS NULL OR (locale IS NOT NULL AND context IS NOT NULL));
  END IF;
END
$$;
