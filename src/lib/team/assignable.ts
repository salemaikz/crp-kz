// Какие курсы руководитель вправе назначать. Назначение выдаёт доступ без покупки, поэтому правило строгое.
import { getDb } from '../db';
import type { AssignableCourse } from './types';

/**
 * Назначаемые курсы организации (опубликованные):
 * - internal-курсы этой организации;
 * - public-курсы: бесплатные — любой организации; платные — только организации-владельцу платформы
 *   (ЦРП учит своих сотрудников). Организация-клиент не может «назначить» платный курс в обход
 *   покупки — для неё будут места (seat), B2B после MVP.
 * Чужие internal-курсы, private и черновики не назначаются никогда.
 */
export async function listAssignableCourses(orgId: string): Promise<AssignableCourse[]> {
  const db = await getDb();
  const rows = await db.sql<AssignableCourse>`
    SELECT c.id, c.slug, c.title, c.visibility, o.price_kzt, o.access_days
    FROM organizations org
    CROSS JOIN courses c
    LEFT JOIN course_offers o ON o.course_id = c.id
    WHERE org.id = ${orgId}
      AND c.status = 'published'
      AND (
        (c.visibility = 'internal' AND c.owner_org_id = org.id)
        OR (c.visibility = 'public' AND (org.kind = 'owner' OR COALESCE(o.price_kzt, 0) = 0))
      )
    ORDER BY (c.visibility = 'internal') DESC, c.position, c.created_at, c.id`;
  return rows.map((r) => ({
    ...r,
    priceKzt: r.priceKzt === null ? null : Number(r.priceKzt),
    accessDays: r.accessDays === null ? null : Number(r.accessDays),
  }));
}
