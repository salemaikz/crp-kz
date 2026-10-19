-- Схема v1 платформы обучения ЦРП. Нормативно: docs/lms/BUILD.md §3.
-- Идемпотентно: повторный прогон ничего не меняет. id — TEXT (UUID), время — BIGINT epoch-мс,
-- деньги — BIGINT в целых тенге, локализованные поля — jsonb {"ru": "...", "kz": "..."}.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,                       -- NULL: аккаунт без пароля (вход невозможен до установки)
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('admin', 'author', 'learner')),
  locale        TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'kz')),
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('owner', 'client')),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
  org_id     TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
  position   TEXT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members (user_id);

CREATE TABLE IF NOT EXISTS courses (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        JSONB NOT NULL,
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  description  JSONB NOT NULL DEFAULT '{}'::jsonb,
  cover        TEXT,
  level        TEXT CHECK (level IS NULL OR level IN ('start', 'base', 'pro')),
  duration_min INT NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
  visibility   TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal', 'private')),
  owner_org_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  sequential   BOOLEAN NOT NULL DEFAULT false,
  position     INT NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_modules (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  position   INT NOT NULL DEFAULT 0,
  title      JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS course_modules_course_pos_idx ON course_modules (course_id, position);

CREATE TABLE IF NOT EXISTS lessons (
  id           TEXT PRIMARY KEY,
  course_id    TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  module_id    TEXT NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
  position     INT NOT NULL DEFAULT 0,
  slug         TEXT NOT NULL,
  title        JSONB NOT NULL,
  content      JSONB NOT NULL DEFAULT '{"ru": {"v": 1, "blocks": []}}'::jsonb,
  duration_min INT NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  UNIQUE (course_id, slug)
);
CREATE INDEX IF NOT EXISTS lessons_module_pos_idx ON lessons (module_id, position);

CREATE TABLE IF NOT EXISTS course_offers (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL UNIQUE REFERENCES courses (id) ON DELETE CASCADE,
  price_kzt   BIGINT NOT NULL DEFAULT 0 CHECK (price_kzt >= 0),
  access_days INT CHECK (access_days IS NULL OR access_days > 0),   -- NULL — бессрочно
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,
  user_id        TEXT REFERENCES users (id) ON DELETE SET NULL,
  course_id      TEXT NOT NULL REFERENCES courses (id) ON DELETE RESTRICT,
  amount_kzt     BIGINT NOT NULL CHECK (amount_kzt >= 0),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  buyer_type     TEXT NOT NULL CHECK (buyer_type IN ('person', 'company')),
  buyer_name     TEXT NOT NULL,
  buyer_email    TEXT NOT NULL,
  buyer_phone    TEXT NOT NULL,
  company_name   TEXT,
  company_bin    TEXT CHECK (company_bin IS NULL OR company_bin ~ '^[0-9]{12}$'),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('kaspi', 'invoice')),
  paid_at        BIGINT,
  decided_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  CHECK (buyer_type <> 'company' OR (company_name IS NOT NULL AND company_bin IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id  TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (source IN ('purchase', 'assignment', 'seat', 'grant', 'self')),
  org_id     TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  order_id   TEXT REFERENCES orders (id) ON DELETE SET NULL,
  granted_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  due_at     BIGINT,
  expires_at BIGINT,
  revoked_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS enrollments_user_idx ON enrollments (user_id);
CREATE INDEX IF NOT EXISTS enrollments_course_idx ON enrollments (course_id);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id    TEXT NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  course_id    TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  completed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS lesson_progress_user_course_idx ON lesson_progress (user_id, course_id);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id  TEXT NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  block_id   TEXT NOT NULL,
  correct    INT NOT NULL CHECK (correct >= 0),
  total      INT NOT NULL CHECK (total >= 0),
  passed     BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_attempts_user_lesson_idx ON quiz_attempts (user_id, lesson_id);

CREATE TABLE IF NOT EXISTS certificates (
  id          TEXT PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id   TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  locale      TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'kz')),
  issued_at   BIGINT NOT NULL,
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS certificates_course_idx ON certificates (course_id);

CREATE TABLE IF NOT EXISTS consents (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  order_id   TEXT REFERENCES orders (id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  version    TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS consents_user_idx ON consents (user_id);

-- Журнал действий: без FK, чтобы записи переживали удаление пользователей и сущностей.
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at);
