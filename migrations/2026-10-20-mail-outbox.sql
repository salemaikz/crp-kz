-- Почта и одноразовые ссылки: токены сброса пароля и подтверждения email, очередь писем.
-- Нормативно: docs/lms/BUILD.md §3, §5; DECISIONS D-030 (очередь писем), D-031 (одноразовые ссылки).
-- Идемпотентно, только добавляет.
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
-- Полный индекс под внешний ключ (частичный выше не покрывает использованные токены при удалении пользователя).
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id);

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
  lease_until_at    BIGINT,                                         -- аренда воркера: истекла — письмо берётся снова
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
-- Очистка секретов: ищем только письма, где токен ещё лежит.
CREATE INDEX IF NOT EXISTS mail_outbox_secret_expires_idx ON mail_outbox (secret_expires_at) WHERE secret IS NOT NULL;
