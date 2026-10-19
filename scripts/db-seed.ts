// npm run db:seed — миграции + демо-данные, если таблица users пуста.
// Только для демо и разработки: сид создаёт учётки с публичным паролем (README).
import { openDriver } from '../src/lib/db';
import { migrate } from '../src/lib/db/migrate';
import { seedRefusal } from '../src/lib/db/seed-guard';
import { seed } from '../src/lib/db/seed';

async function main(): Promise<number> {
  // Сначала разрешение, потом любые записи (в том числе миграции)
  const refusal = seedRefusal();
  if (refusal) {
    console.error(refusal);
    return 1;
  }
  const db = await openDriver();
  try {
    await migrate(db);
    const { seeded } = await seed(db);
    console.log(seeded ? 'Демо-данные записаны.' : 'В users уже есть строки — сид пропущен.');
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
