-- Права приложения на объекты схемы (D-026). Идемпотентно; выполняется после каждого прогона
-- миграций (scripts/db-grants.ts от crp_owner) и после восстановления (restore.sh).
-- Имена ролей приходят параметрами сессии crp.app_role и crp.owner_role (set_config), а не
-- склейкой строк. Схема — текущая (в тестах на Postgres — временная схема теста).
--   crp_app: SELECT/INSERT/UPDATE/DELETE на таблицы;
--   audit_log — только SELECT и INSERT (журнал не правится и не чистится приложением);
--   schema_migrations — только SELECT (учёт миграций ведёт владелец схемы).
DO $$
DECLARE
  app   text := current_setting('crp.app_role');
  owner text := current_setting('crp.owner_role');
  s     text := current_schema();
BEGIN
  IF app !~ '^[a-z_][a-z0-9_]{0,62}$' OR owner !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'grants.sql: недопустимое имя роли';
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, app);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', s, app);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', s, app);
  -- Таблицы из будущих миграций получают те же права сразу (страховка, если db-grants не запустили).
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', owner, s, app);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', owner, s, app);

  -- Журнал действий только дописывается.
  IF to_regclass(format('%I.audit_log', s)) IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.audit_log FROM %I', s, app);
  END IF;
  -- Учёт миграций ведёт только владелец схемы.
  IF to_regclass(format('%I.schema_migrations', s)) IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.schema_migrations FROM %I', s, app);
  END IF;
END
$$;
