// npm run db:migrate — применить миграции к DATABASE_URL (или к PGLITE_DIR в демо).
import { openDriver } from '../src/lib/db';
import { migrate } from '../src/lib/db/migrate';
import { isDemo } from '../src/lib/env';

async function main() {
  if (isDemo() && !process.env.PGLITE_DIR) {
    console.log('DATABASE_URL и PGLITE_DIR не заданы: БД в памяти, миграции применяются при старте приложения.');
  }
  const db = await openDriver();
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'Новых миграций нет.');
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
