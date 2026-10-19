// Сид демо-данных. Нормативно: docs/lms/BUILD.md §2 (сид), §5 (демо-аккаунты), §9 (состав).
// Демо-контент курсов — в ./content (отдельный поток), здесь — люди, доступы, заказы, прогресс.
import type { Db } from '../core';
import { SEED_COURSES } from './content';
import { seedCourses, type SeedResult } from './run';

export { seedCourses, type SeedResult } from './run';
export { pickSeedRoles, seedCertificateNumber } from './activity';
export { SEED_ORG, SEED_PEOPLE, seedOrgId, seedUserId } from './people';
export { seedLessonId, seedModuleId, seedOfferId } from './courses';

/** Сид с демо-курсами. Ничего не делает, если в users уже есть строки. */
export function seed(db: Db, opts: { nowMs?: number } = {}): Promise<SeedResult> {
  return seedCourses(db, SEED_COURSES, opts);
}
