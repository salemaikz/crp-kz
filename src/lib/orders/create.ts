// Создание заказа (Фаза 0, D-007): pending, сумма — из предложения курса в момент заказа.
import { canAccessCourse } from '../access';
import { getDb, newId, now } from '../db';
import { orderAccessKey } from './access-key';
import { formatOrderNumber, randomOrderDigits } from './number';
import { getCourseForSale } from './queries';
import { CONSENT_KINDS, CONSENT_VERSION, OrderError } from './types';
import type { CheckoutInput } from './validation';

export type CreateOrderOptions = {
  /** Вошедший пользователь (из сессии) или null для гостя. */
  userId: string | null;
  /** Источник 4 цифр номера — для тестов коллизий. */
  digits?: () => number;
  maxAttempts?: number;
};

export type CreatedOrder = { id: string; number: string; amountKzt: number; userId: string | null; accessKey: string };

/** Вставить заказ с уникальным номером: при совпадении — новые цифры (ON CONFLICT без ошибки в транзакции). */
async function insertWithNumber(
  t: number,
  digits: () => number,
  maxAttempts: number,
  insert: (number: string) => Promise<boolean>,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = formatOrderNumber(t, digits());
    if (await insert(candidate)) return candidate;
  }
  throw new OrderError('number_exhausted');
}

/**
 * Создать заказ. Проверки: курс продаётся (иначе not_for_sale), у вошедшего нет действующего
 * доступа (иначе has_access). user_id — вошедший, иначе существующий пользователь с этим email,
 * иначе NULL (аккаунт создадим при оплате). Согласия offer и pd_processing — к заказу.
 */
export async function createOrder(input: CheckoutInput, opts: CreateOrderOptions): Promise<CreatedOrder> {
  const db = await getDb();
  const digits = opts.digits ?? randomOrderDigits;
  const maxAttempts = opts.maxAttempts ?? 25;

  const created = await db.tx(async (sql) => {
    const sale = await getCourseForSale(input.courseSlug, sql);
    if (sale.kind !== 'ok') throw new OrderError('not_for_sale');
    const course = sale.course;

    if (opts.userId && (await canAccessCourse(opts.userId, course.id, sql)).ok) {
      throw new OrderError('has_access');
    }

    let userId = opts.userId;
    if (!userId) {
      const [u] = await sql<{ id: string }>`SELECT id FROM users WHERE email = ${input.email}`;
      userId = u?.id ?? null;
    }

    const t = now();
    const id = newId();
    const amountKzt = course.priceKzt; // только из БД, никогда из формы
    const number = await insertWithNumber(t, digits, maxAttempts, async (candidate) => {
      const rows = await sql`
        INSERT INTO orders (id, number, user_id, course_id, amount_kzt, status, buyer_type, buyer_name,
                            buyer_email, buyer_phone, company_name, company_bin, payment_method,
                            paid_at, decided_by, created_at, updated_at)
        VALUES (${id}, ${candidate}, ${userId}, ${course.id}, ${amountKzt}, 'pending', ${input.buyerType},
                ${input.name}, ${input.email}, ${input.phone}, ${input.companyName}, ${input.companyBin},
                ${input.paymentMethod}, NULL, NULL, ${t}, ${t})
        ON CONFLICT (number) DO NOTHING
        RETURNING id`;
      return rows.length > 0;
    });

    for (const kind of CONSENT_KINDS) {
      await sql`
        INSERT INTO consents (id, user_id, order_id, kind, version, created_at)
        VALUES (${newId()}, ${userId}, ${id}, ${kind}, ${CONSENT_VERSION}, ${t})`;
    }
    // в журнал — без персональных данных покупателя
    await sql`
      INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
      VALUES (${newId()}, ${opts.userId}, 'order.create', 'order', ${id},
              ${db.json({
                number,
                courseId: course.id,
                amountKzt,
                paymentMethod: input.paymentMethod,
                buyerType: input.buyerType,
              })}, ${t})`;
    return { id, number, amountKzt, userId };
  });

  return { ...created, accessKey: orderAccessKey(created.id) };
}
