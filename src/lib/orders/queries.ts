// Чтение заказов и курсов для покупки. Без контекста запроса Next — вызывается из страниц и тестов.
import { canAccessCourse, getEnrollment, type Enrollment } from '../access';
import { getDb, type Sql } from '../db';
import type { BuyableCourse, L10nField, Order, OrderStatus, OrderView } from './types';

async function q(sql?: Sql): Promise<Sql> {
  return sql ?? (await getDb()).sql;
}

/** Можно ли купить курс: missing → 404; not_for_sale → на страницу курса; ok → форма покупки. */
export type CourseSaleState =
  | { kind: 'missing' }
  | { kind: 'not_for_sale'; slug: string }
  | { kind: 'ok'; course: BuyableCourse };

type SaleRow = {
  id: string;
  slug: string;
  title: L10nField;
  summary: L10nField;
  level: string | null;
  durationMin: number;
  visibility: string;
  status: string;
  priceKzt: number | null;
  accessDays: number | null;
  offerActive: boolean | null;
  modulesCount: number;
  lessonsCount: number;
};

/**
 * Курс для покупки по slug. Продаётся только опубликованный public-курс
 * с активным предложением и ценой > 0; бесплатные и внутренние купить нельзя.
 */
export async function getCourseForSale(slug: string, sql?: Sql): Promise<CourseSaleState> {
  const s = await q(sql);
  const [c] = await s<SaleRow>`
    SELECT c.id, c.slug, c.title, c.summary, c.level, c.duration_min, c.visibility, c.status,
           f.price_kzt, f.access_days, f.active AS offer_active,
           (SELECT count(DISTINCT l.module_id) FROM lessons l
             WHERE l.course_id = c.id AND l.status = 'published') AS modules_count,
           (SELECT count(*) FROM lessons l
             WHERE l.course_id = c.id AND l.status = 'published') AS lessons_count
    FROM courses c
    LEFT JOIN course_offers f ON f.course_id = c.id
    WHERE c.slug = ${slug}`;
  if (!c || c.status !== 'published' || c.visibility !== 'public') return { kind: 'missing' };
  if (!c.offerActive || !c.priceKzt || c.priceKzt <= 0) return { kind: 'not_for_sale', slug: c.slug };
  return {
    kind: 'ok',
    course: {
      id: c.id,
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      level: c.level,
      durationMin: c.durationMin,
      priceKzt: c.priceKzt,
      accessDays: c.accessDays,
      modulesCount: Number(c.modulesCount),
      lessonsCount: Number(c.lessonsCount),
    },
  };
}

/** Что делать пользователю на странице покупки: купить или уже учиться (действующий доступ). */
export async function buyState(userId: string | null, courseId: string, sql?: Sql): Promise<'buy' | 'has_access'> {
  if (!userId) return 'buy';
  return (await canAccessCourse(userId, courseId, sql)).ok ? 'has_access' : 'buy';
}

/** Последний неоплаченный заказ пользователя на курс — чтобы не плодить дубли. */
export async function findOpenOrder(userId: string, courseId: string, sql?: Sql): Promise<Order | null> {
  const s = await q(sql);
  const [o] = await s<Order>`
    SELECT * FROM orders
    WHERE user_id = ${userId} AND course_id = ${courseId} AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1`;
  return o ?? null;
}

export async function getOrderById(id: string, sql?: Sql): Promise<Order | null> {
  const s = await q(sql);
  const [o] = await s<Order>`SELECT * FROM orders WHERE id = ${id}`;
  return o ?? null;
}

/** Заказ с курсом по номеру (для страниц статуса и счёта). Права проверяет вызывающий. */
export async function getOrderByNumber(number: string, sql?: Sql): Promise<OrderView | null> {
  const s = await q(sql);
  const [o] = await s<OrderView>`
    SELECT o.*, c.slug AS course_slug, c.title AS course_title
    FROM orders o
    JOIN courses c ON c.id = o.course_id
    WHERE o.number = ${number}`;
  return o ?? null;
}

export type OrderFilter = OrderStatus | 'all';

/** Заказы для админки, новые сверху. */
export async function listOrders(filter: OrderFilter = 'all', limit = 200, sql?: Sql): Promise<OrderView[]> {
  const s = await q(sql);
  if (filter === 'all') {
    return s<OrderView>`
      SELECT o.*, c.slug AS course_slug, c.title AS course_title
      FROM orders o
      JOIN courses c ON c.id = o.course_id
      ORDER BY o.created_at DESC, o.number DESC
      LIMIT ${limit}`;
  }
  return s<OrderView>`
    SELECT o.*, c.slug AS course_slug, c.title AS course_title
    FROM orders o
    JOIN courses c ON c.id = o.course_id
    WHERE o.status = ${filter}
    ORDER BY o.created_at DESC, o.number DESC
    LIMIT ${limit}`;
}

export type OrderStats = Record<OrderStatus, { count: number; amountKzt: number }>;

/** Количество и сумма заказов по статусам — счётчики вкладок и сводка. */
export async function orderStats(sql?: Sql): Promise<OrderStats> {
  const s = await q(sql);
  const rows = await s<{ status: OrderStatus; n: number; total: number }>`
    SELECT status, count(*) AS n, coalesce(sum(amount_kzt), 0)::bigint AS total
    FROM orders GROUP BY status`;
  const out: OrderStats = {
    pending: { count: 0, amountKzt: 0 },
    paid: { count: 0, amountKzt: 0 },
    cancelled: { count: 0, amountKzt: 0 },
    refunded: { count: 0, amountKzt: 0 },
  };
  for (const r of rows) out[r.status] = { count: Number(r.n), amountKzt: Number(r.total) };
  return out;
}

/** Зачисление покупателя на курс заказа (для «доступ до …» на странице оплаченного заказа). */
export async function orderEnrollment(
  order: Pick<Order, 'userId' | 'courseId'>,
  sql?: Sql,
): Promise<Enrollment | null> {
  if (!order.userId) return null;
  return getEnrollment(order.userId, order.courseId, sql);
}
