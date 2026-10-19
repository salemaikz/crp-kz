// Сид: курсы → модули → уроки → предложения из SeedCourse[] с детерминированными id.
import { lessonContentSchema } from '../../content/blocks';
import { seedId } from '../../content/ids';
import type { SeedCourse } from '../../content/types';
import type { Sql } from '../core';
import { seedOrgId } from './people';
import { DAY } from './time';

export type SeededQuiz = { blockId: string; total: number; passScore: number };
export type SeededLesson = { id: string; slug: string; quizzes: SeededQuiz[] };
export type SeededCourse = { course: SeedCourse; lessons: SeededLesson[] };

export const seedModuleId = (courseId: string, index: number): string => seedId('module', `${courseId}:${index}`);
export const seedLessonId = (courseId: string, slug: string): string => seedId('lesson', `${courseId}:${slug}`);
export const seedOfferId = (courseId: string): string => seedId('offer', courseId);

export const isFreeCourse = (c: SeedCourse): boolean => !c.priceKzt;

/** Проверка демо-контента до записи: понятная ошибка вместо падения на середине сида. */
export function validateSeedCourses(courses: readonly SeedCourse[]): void {
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const c of courses) {
    if (slugs.has(c.slug) || ids.has(c.id)) throw new Error(`seed: duplicate course ${c.slug}`);
    slugs.add(c.slug);
    ids.add(c.id);
    if (c.visibility === 'internal' && !c.ownerOrg) throw new Error(`seed: internal course ${c.slug} needs ownerOrg`);
    const lessonSlugs = new Set<string>();
    for (const m of c.modules) {
      for (const l of m.lessons) {
        if (lessonSlugs.has(l.slug)) throw new Error(`seed: duplicate lesson ${c.slug}/${l.slug}`);
        lessonSlugs.add(l.slug);
        const res = lessonContentSchema.safeParse(l.content);
        if (!res.success) {
          const issue = res.error.issues[0];
          throw new Error(`seed: invalid content ${c.slug}/${l.slug}: ${issue?.path.join('.')} ${issue?.message}`);
        }
      }
    }
  }
}

function quizzesOf(l: SeedCourse['modules'][number]['lessons'][number]): SeededQuiz[] {
  const out: SeededQuiz[] = [];
  for (const b of l.content.ru.blocks) {
    if (b.type === 'quiz') out.push({ blockId: b.id, total: b.questions.length, passScore: b.passScore });
  }
  return out;
}

export async function insertCourses(
  sql: Sql,
  json: (v: unknown) => unknown,
  courses: readonly SeedCourse[],
  base: number,
): Promise<SeededCourse[]> {
  const created = base - 90 * DAY;
  const updated = base - 10 * DAY;
  const out: SeededCourse[] = [];
  for (const [ci, c] of courses.entries()) {
    const ownerOrgId = c.ownerOrg === 'crp' ? seedOrgId() : null;
    await sql`
      INSERT INTO courses (id, slug, title, summary, description, cover, level, duration_min, visibility,
                           owner_org_id, status, sequential, position, created_at, updated_at)
      VALUES (${c.id}, ${c.slug}, ${json(c.title)}, ${json(c.summary)}, ${json(c.description)}, NULL, ${c.level},
              ${c.durationMin}, ${c.visibility}, ${ownerOrgId}, 'published', ${c.sequential}, ${ci},
              ${created}, ${updated})
      ON CONFLICT (id) DO NOTHING`;
    if (c.priceKzt) {
      await sql`
        INSERT INTO course_offers (id, course_id, price_kzt, access_days, active, created_at)
        VALUES (${seedOfferId(c.id)}, ${c.id}, ${c.priceKzt}, ${c.accessDays}, true, ${created})
        ON CONFLICT (id) DO NOTHING`;
    }
    const lessons: SeededLesson[] = [];
    for (const [mi, m] of c.modules.entries()) {
      const moduleId = seedModuleId(c.id, mi);
      await sql`
        INSERT INTO course_modules (id, course_id, position, title, created_at)
        VALUES (${moduleId}, ${c.id}, ${mi}, ${json(m.title)}, ${created})
        ON CONFLICT (id) DO NOTHING`;
      for (const [li, l] of m.lessons.entries()) {
        const lessonId = seedLessonId(c.id, l.slug);
        await sql`
          INSERT INTO lessons (id, course_id, module_id, position, slug, title, content, duration_min, status,
                               created_at, updated_at)
          VALUES (${lessonId}, ${c.id}, ${moduleId}, ${li}, ${l.slug}, ${json(l.title)}, ${json(l.content)},
                  ${l.durationMin}, 'published', ${created}, ${updated})
          ON CONFLICT (id) DO NOTHING`;
        lessons.push({ id: lessonId, slug: l.slug, quizzes: quizzesOf(l) });
      }
    }
    out.push({ course: c, lessons });
  }
  return out;
}
