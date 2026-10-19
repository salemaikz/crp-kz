// npm run db:seed — миграции + демо-данные, если таблица users пуста.
import { openDriver } from '../src/lib/db';
import { migrate } from '../src/lib/db/migrate';
import { seed } from '../src/lib/db/seed';

async function main() {
  const db = await openDriver();
  try {
    await migrate(db);
    const { seeded } = await seed(db);
    console.log(seeded ? 'Демо-данные записаны.' : 'В users уже есть строки — сид пропущен.');
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
