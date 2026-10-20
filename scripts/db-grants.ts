// npm run db:grants — выдать роли приложения права на таблицы (deploy/postgres/grants.sql).
// Запускается от владельца схемы (migrate.env) после db:migrate; идемпотентно.
// На PGlite ролей нет: сообщение и код 0. Коды: 0 — готово, 1 — ошибка.
import { openDriver } from '../src/lib/db';
import { applyGrants, grantRoles } from '../src/lib/ops/grants';

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    console.error('Использование: db-grants.ts (роли — DB_APP_ROLE и DB_OWNER_ROLE)');
    return 1;
  }
  const roles = grantRoles();
  const db = await openDriver();
  try {
    if (db.driver !== 'postgres') {
      console.log('Роли — только на Postgres: на PGlite права не выдаются.');
      return 0;
    }
    await applyGrants(db, roles);
    console.log('Права выданы.');
    return 0;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
