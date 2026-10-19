// Полный сид с заданным списком курсов. Без импорта демо-контента — удобно для тестов.
import { DEMO_PASSWORD } from '../../auth/demo';
import { hashPassword } from '../../auth/password';
import type { SeedCourse } from '../../content/types';
import type { Db } from '../core';
import { seedActivity } from './activity';
import { insertCourses, validateSeedCourses } from './courses';
import { SEED_LOCK_KEY } from '../locks';
import { seedPeople } from './people';
import { seedBase } from './time';

export type SeedResult = { seeded: boolean };

/**
 * Сид демо-данных: ЦРП, демо-аккаунты и сотрудники, курсы, назначения, заказы, сертификат, журнал.
 * Выполняется в одной транзакции и только если таблица users пуста.
 */
export async function seedCourses(
  db: Db,
  courses: readonly SeedCourse[],
  opts: { nowMs?: number } = {},
): Promise<SeedResult> {
  validateSeedCourses(courses);
  const base = seedBase(opts.nowMs ?? Date.now());
  const passwordHash = await hashPassword(DEMO_PASSWORD); // один хеш на всех демо-пользователей
  return db.tx(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`;
    const [row] = await sql<{ has: boolean }>`SELECT EXISTS (SELECT 1 FROM users) AS has`;
    if (row?.has) return { seeded: false };
    const ctx = { sql, json: db.json, base };
    await seedPeople(sql, base, passwordHash);
    const seeded = await insertCourses(sql, db.json, courses, base);
    await seedActivity(ctx, seeded);
    return { seeded: true };
  });
}
