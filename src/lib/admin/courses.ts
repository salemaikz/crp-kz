// Курсы в админке: список, чтение для формы, создание, правка, публикация, удаление.
// Цена хранится в course_offers: цена 0 или пусто — предложения нет (курс бесплатный).
import { getDb, isUniqueViolation, newId, now, type Sql } from '../db';
import type { L10n } from '../content/types';
import { writeAudit } from './audit';
import { AdminError } from './errors';
import { assertAdmin, type Actor } from './guard';
import {
  courseInputSchema,
  parseOrThrow,
  PUBLISH_STATUSES,
  toL10n,
  toOptionalL10n,
  type CourseInput,
} from './schemas';
import { pickFreeSlug, slugify } from './slug';

export type CourseStatus = (typeof PUBLISH_STATUSES)[number];
export type CourseVisibility = 'public' | 'internal' | 'private';
export type CourseLevel = 'start' | 'base' | 'pro';

export type CourseListItem = {
  id: string;
  slug: string;
  title: L10n;
  status: CourseStatus;
  visibility: CourseVisibility;
  level: CourseLevel | null;
  priceKzt: number | null;
  offerActive: boolean | null;
  lessonsTotal: number;
  lessonsPublished: number;
  enrollmentsActive: number;
  updatedAt: number;
};

export type CourseDetail = {
  id: string;
  slug: string;
  title: L10n;
  summary: Partial<L10n>;
  description: Partial<L10n>;
  level: CourseLevel | null;
  durationMin: number;
  visibility: CourseVisibility;
  ownerOrgId: string | null;
  ownerOrgName: string | null;
  sequential: boolean;
  status: CourseStatus;
  createdAt: number;
  updatedAt: number;
  priceKzt: number | null;
  accessDays: number | null;
  lessonsTotal: number;
  lessonsPublished: number;
  lessonsMinutes: number;
  enrollmentsActive: number;
  enrollmentsTotal: number;
  ordersTotal: number;
  certificatesTotal: number;
};

export type OrganizationOption = { id: string; name: string; kind: 'owner' | 'client' };

// ---------- чтение ----------

export async function listCourses(
  actor: Actor,
  filter: { status?: CourseStatus; q?: string } = {},
): Promise<CourseListItem[]> {
  await assertAdmin(actor);
  const db = await getDb();
  const status = filter.status ?? null;
  const q = filter.q?.trim() ? `%${escapeLike(filter.q.trim())}%` : null;
  const t = now();
  return db.sql<CourseListItem>`
    SELECT c.id, c.slug, c.title, c.status, c.visibility, c.level, c.updated_at,
           o.price_kzt, o.active AS offer_active,
           (SELECT count(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_total,
           (SELECT count(*) FROM lessons l WHERE l.course_id = c.id AND l.status = 'published') AS lessons_published,
           (SELECT count(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at > ${t})
           ) AS enrollments_active
    FROM courses c
    LEFT JOIN course_offers o ON o.course_id = c.id
    WHERE (${status}::text IS NULL OR c.status = ${status})
      AND (${q}::text IS NULL OR c.title->>'ru' ILIKE ${q} OR c.title->>'kz' ILIKE ${q} OR c.slug ILIKE ${q})
    ORDER BY c.position, c.created_at, c.id`;
}

export async function getCourse(actor: Actor, courseId: string): Promise<CourseDetail | null> {
  await assertAdmin(actor);
  const db = await getDb();
  const t = now();
  const [row] = await db.sql<CourseDetail>`
    SELECT c.id, c.slug, c.title, c.summary, c.description, c.level, c.duration_min, c.visibility,
           c.owner_org_id, org.name AS owner_org_name, c.sequential, c.status, c.created_at, c.updated_at,
           o.price_kzt, o.access_days,
           (SELECT count(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_total,
           (SELECT count(*) FROM lessons l WHERE l.course_id = c.id AND l.status = 'published') AS lessons_published,
           (SELECT COALESCE(sum(l.duration_min), 0) FROM lessons l WHERE l.course_id = c.id) AS lessons_minutes,
           (SELECT count(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at > ${t})
           ) AS enrollments_active,
           (SELECT count(*) FROM enrollments e WHERE e.course_id = c.id) AS enrollments_total,
           (SELECT count(*) FROM orders r WHERE r.course_id = c.id) AS orders_total,
           (SELECT count(*) FROM certificates x WHERE x.course_id = c.id) AS certificates_total
    FROM courses c
    LEFT JOIN course_offers o ON o.course_id = c.id
    LEFT JOIN organizations org ON org.id = c.owner_org_id
    WHERE c.id = ${courseId}`;
  return row ?? null;
}

export async function listOrganizations(actor: Actor): Promise<OrganizationOption[]> {
  await assertAdmin(actor);
  const db = await getDb();
  return db.sql<OrganizationOption>`
    SELECT id, name, kind FROM organizations ORDER BY (kind = 'owner') DESC, name`;
}

export type CourseOption = { id: string; title: L10n; status: CourseStatus; priceKzt: number | null };

/** Все курсы для выпадающего списка (выдача доступа). */
export async function listCourseOptions(actor: Actor): Promise<CourseOption[]> {
  await assertAdmin(actor);
  const db = await getDb();
  return db.sql<CourseOption>`
    SELECT c.id, c.title, c.status, o.price_kzt
    FROM courses c LEFT JOIN course_offers o ON o.course_id = c.id
    ORDER BY c.position, c.created_at, c.id`;
}

// ---------- запись ----------

/** Экранирование % и _ в шаблоне ILIKE (поиск по буквальной подстроке). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

async function slugTaken(sql: Sql, slug: string, exceptId: string | null): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM courses WHERE slug = ${slug} AND (${exceptId}::text IS NULL OR id <> ${exceptId})`;
  return rows.length > 0;
}

async function assertOrgExists(sql: Sql, orgId: string | null): Promise<void> {
  if (!orgId) return;
  const rows = await sql`SELECT 1 FROM organizations WHERE id = ${orgId}`;
  if (rows.length === 0) throw new AdminError('VALIDATION', { ownerOrgId: 'invalid' });
}

/** Предложение курса: цена > 0 — активная строка course_offers, иначе предложения нет. */
async function applyOffer(sql: Sql, courseId: string, priceKzt: number, accessDays: number | null): Promise<void> {
  if (priceKzt > 0) {
    await sql`
      INSERT INTO course_offers (id, course_id, price_kzt, access_days, active, created_at)
      VALUES (${newId()}, ${courseId}, ${priceKzt}, ${accessDays}, true, ${now()})
      ON CONFLICT (course_id) DO UPDATE
        SET price_kzt = EXCLUDED.price_kzt, access_days = EXCLUDED.access_days, active = true`;
  } else {
    // свободный курс без предложения: иначе «пауза продаж» оставила бы цену > 0 и запретила self
    await sql`DELETE FROM course_offers WHERE course_id = ${courseId}`;
  }
}

async function assertCanPublish(sql: Sql, courseId: string): Promise<void> {
  const [row] = await sql<{ n: number }>`
    SELECT count(*) AS n FROM lessons WHERE course_id = ${courseId} AND status = 'published'`;
  if (!row || row.n === 0) throw new AdminError('NO_PUBLISHED_LESSONS', { status: 'noPublishedLessons' });
}

export async function createCourse(actor: Actor, raw: unknown): Promise<{ id: string; slug: string }> {
  await assertAdmin(actor);
  const input = parseOrThrow(courseInputSchema, raw);
  const db = await getDb();
  try {
    return await db.tx(async (sql) => {
      await assertOrgExists(sql, input.ownerOrgId);
      let slug = input.slug;
      if (slug) {
        if (await slugTaken(sql, slug, null)) throw new AdminError('SLUG_TAKEN', { slug: 'slugTaken' });
      } else {
        slug = await pickFreeSlug(slugify(input.titleRu) || 'course', (s) => slugTaken(sql, s, null));
      }
      const id = newId();
      const t = now();
      // публикация при создании невозможна: у нового курса нет уроков
      if (input.status === 'published') throw new AdminError('NO_PUBLISHED_LESSONS', { status: 'noPublishedLessons' });
      const [pos] = await sql<{ next: number }>`SELECT COALESCE(max(position) + 1, 0) AS next FROM courses`;
      await sql`
        INSERT INTO courses (id, slug, title, summary, description, cover, level, duration_min, visibility,
                             owner_org_id, status, sequential, position, created_at, updated_at)
        VALUES (${id}, ${slug}, ${db.json(toL10n(input.titleRu, input.titleKz))},
                ${db.json(toOptionalL10n(input.summaryRu, input.summaryKz))},
                ${db.json(toOptionalL10n(input.descriptionRu, input.descriptionKz))}, NULL,
                ${input.level}, ${input.durationMin}, ${input.visibility}, ${ownerFor(input)}, 'draft',
                ${input.sequential}, ${pos?.next ?? 0}, ${t}, ${t})`;
      await applyOffer(sql, id, input.priceKzt, input.accessDays);
      await writeAudit(sql, actor.id, 'course.create', 'course', id, {
        courseId: id,
        title: input.titleRu,
        slug,
        priceKzt: input.priceKzt,
      });
      return { id, slug };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError('SLUG_TAKEN', { slug: 'slugTaken' });
    throw e;
  }
}

/** Организация-владелец хранится только у внутренних и закрытых курсов. */
function ownerFor(input: CourseInput): string | null {
  return input.visibility === 'public' ? null : input.ownerOrgId;
}

type CourseRow = {
  id: string;
  slug: string;
  title: L10n;
  summary: Partial<L10n>;
  description: Partial<L10n>;
  level: CourseLevel | null;
  durationMin: number;
  visibility: CourseVisibility;
  ownerOrgId: string | null;
  sequential: boolean;
  status: CourseStatus;
};

export async function updateCourse(actor: Actor, courseId: string, raw: unknown): Promise<{ slug: string }> {
  await assertAdmin(actor);
  const input = parseOrThrow(courseInputSchema, raw);
  const db = await getDb();
  try {
    return await db.tx(async (sql) => {
      const [cur] = await sql<CourseRow>`
        SELECT id, slug, title, summary, description, level, duration_min, visibility, owner_org_id,
               sequential, status
        FROM courses WHERE id = ${courseId} FOR UPDATE`;
      if (!cur) throw new AdminError('NOT_FOUND');
      await assertOrgExists(sql, input.ownerOrgId);

      let slug = cur.slug;
      if (input.slug && input.slug !== cur.slug) {
        if (await slugTaken(sql, input.slug, courseId)) throw new AdminError('SLUG_TAKEN', { slug: 'slugTaken' });
        slug = input.slug;
      }
      const statusChanged = input.status !== cur.status;
      if (statusChanged && input.status === 'published') await assertCanPublish(sql, courseId);

      const [offer] = await sql<{ priceKzt: number; accessDays: number | null }>`
        SELECT price_kzt, access_days FROM course_offers WHERE course_id = ${courseId}`;
      const next = {
        title: toL10n(input.titleRu, input.titleKz),
        summary: toOptionalL10n(input.summaryRu, input.summaryKz),
        description: toOptionalL10n(input.descriptionRu, input.descriptionKz),
        level: input.level,
        durationMin: input.durationMin,
        visibility: input.visibility,
        ownerOrgId: ownerFor(input),
        sequential: input.sequential,
      };
      const changed: string[] = [];
      if (!same(cur.title, next.title)) changed.push('title');
      if (!same(cur.summary, next.summary)) changed.push('summary');
      if (!same(cur.description, next.description)) changed.push('description');
      if (slug !== cur.slug) changed.push('slug');
      if (cur.level !== next.level) changed.push('level');
      if (cur.durationMin !== next.durationMin) changed.push('durationMin');
      if (cur.visibility !== next.visibility) changed.push('visibility');
      if (cur.ownerOrgId !== next.ownerOrgId) changed.push('ownerOrgId');
      if (cur.sequential !== next.sequential) changed.push('sequential');
      if ((offer?.priceKzt ?? 0) !== input.priceKzt) changed.push('price');
      if (input.priceKzt > 0 && (offer?.accessDays ?? null) !== input.accessDays) changed.push('accessDays');

      await sql`
        UPDATE courses SET slug = ${slug}, title = ${db.json(next.title)}, summary = ${db.json(next.summary)},
               description = ${db.json(next.description)}, level = ${next.level},
               duration_min = ${next.durationMin}, visibility = ${next.visibility},
               owner_org_id = ${next.ownerOrgId}, sequential = ${next.sequential},
               status = ${input.status}, updated_at = ${now()}
        WHERE id = ${courseId}`;
      if (changed.includes('price') || changed.includes('accessDays')) {
        await applyOffer(sql, courseId, input.priceKzt, input.accessDays);
      }

      const title = input.titleRu;
      if (changed.length > 0) {
        await writeAudit(sql, actor.id, 'course.update', 'course', courseId, { courseId, title, changed });
      }
      if (statusChanged) {
        await writeAudit(
          sql,
          actor.id,
          input.status === 'published' ? 'course.publish' : 'course.unpublish',
          'course',
          courseId,
          { courseId, title },
        );
      }
      return { slug };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError('SLUG_TAKEN', { slug: 'slugTaken' });
    throw e;
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Быстрая смена статуса (кнопка «Опубликовать» / «Снять с публикации»). */
export async function setCourseStatus(actor: Actor, courseId: string, status: CourseStatus): Promise<void> {
  await assertAdmin(actor);
  if (!PUBLISH_STATUSES.includes(status)) throw new AdminError('VALIDATION', { status: 'invalid' });
  const db = await getDb();
  await db.tx(async (sql) => {
    const [cur] = await sql<{ status: CourseStatus; title: L10n }>`
      SELECT status, title FROM courses WHERE id = ${courseId} FOR UPDATE`;
    if (!cur) throw new AdminError('NOT_FOUND');
    if (cur.status === status) return;
    if (status === 'published') await assertCanPublish(sql, courseId);
    await sql`UPDATE courses SET status = ${status}, updated_at = ${now()} WHERE id = ${courseId}`;
    await writeAudit(sql, actor.id, status === 'published' ? 'course.publish' : 'course.unpublish', 'course', courseId, {
      courseId,
      title: cur.title.ru,
    });
  });
}

/**
 * Удаление курса: только если по нему нет заказов, зачисления и сертификатов
 * (иначе — потеря истории покупок и доступов; такой курс снимают с публикации).
 */
export async function deleteCourse(actor: Actor, courseId: string): Promise<void> {
  await assertAdmin(actor);
  const db = await getDb();
  await db.tx(async (sql) => {
    const [cur] = await sql<{ title: L10n; slug: string }>`SELECT title, slug FROM courses WHERE id = ${courseId} FOR UPDATE`;
    if (!cur) throw new AdminError('NOT_FOUND');
    const [used] = await sql<{ n: number }>`
      SELECT (SELECT count(*) FROM orders WHERE course_id = ${courseId})
           + (SELECT count(*) FROM enrollments WHERE course_id = ${courseId})
           + (SELECT count(*) FROM certificates WHERE course_id = ${courseId}) AS n`;
    if (!used || used.n > 0) throw new AdminError('COURSE_HAS_DATA');
    await sql`DELETE FROM courses WHERE id = ${courseId}`;
    await writeAudit(sql, actor.id, 'course.delete', 'course', courseId, {
      courseId,
      title: cur.title.ru,
      slug: cur.slug,
    });
  });
}
