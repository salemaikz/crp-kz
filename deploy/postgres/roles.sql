-- Разовая установка БД и ролей платформы обучения ЦРП (D-026). Запуск от ОС-пользователя postgres:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v db=crp -v owner=crp_owner -v app=crp_app \
--        -f deploy/postgres/roles.sql
-- Пароли здесь не задаются. После запуска задайте их в psql: \password crp_owner и \password crp_app.
-- Повторный запуск безопасен: создаётся только то, чего нет.
--
-- crp_owner владеет БД и схемой, выполняет DDL (db:migrate, db:grants во время выкладки).
-- crp_app — приложение, крон и CLI: права на данные, но не на DDL (выдаёт grants.sql).

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5', :'owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 40', :'app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec

-- ICU 'und' правильно сортирует кириллицу, включая казахские буквы. После обновления ICU в ОС нужен REINDEX.
SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE %L LOCALE %L',
              :'db', :'owner', 'UTF8', 'und', 'C.UTF-8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', :'db', :'owner', :'app') \gexec

\connect :db
ALTER SCHEMA public OWNER TO :"owner";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";

-- Предохранители на уровне роли: зависший запрос или забытая транзакция не держат блокировки.
SELECT format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L', :'app', :'db', '30s') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET idle_in_transaction_session_timeout = %L', :'app', :'db', '60s') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L', :'owner', :'db', '5s') \gexec
