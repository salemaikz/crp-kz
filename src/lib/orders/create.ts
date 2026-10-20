// Создание заказа (Фаза 0, D-007; D-020): только вошедший пользователь, сумма и срок доступа —
// из предложения курса в момент заказа.
import { canAccessCourse } from '../access';
import { getDb, newId, now } from '../db';
import { writeAudit } from '../audit';
import { isFeatureActive } from '../features';
import { CHECKOUT_CONSENTS, insertConsents, type PreparedConsent } from '../legal';
import { orderAccessKey } from './access-key';
import { formatOrderNumber, randomOrderDigits } from './number';
import { findOpenOrder, getCourseForSale } from './queries';
import { OrderError } from './types';
import type { CheckoutInput } from './validation';

export type CreateOrderOptions = {
  /** Вошедший пользователь — только из сессии. Заказ привязывается к нему и ни к кому другому. */
  userId: string;
  /**
   * Подготовленные вне транзакции согласия (prepareConsents(CHECKOUT_CONSENTS, locale)): offer и
   * pd_processing. Пишутся только для нового заказа этого пользователя.
   */
  consents: PreparedConsent[];
  /**
   * Требовать подтверждённый email (D-032, предложено, ждёт владельца). По умолчанию — активен ли
   * EMAIL_VERIFY: забытая опция не открывает обход.
   */
  requireVerifiedEmail?: boolean;
  /** Источник 4 цифр номера — для тестов коллизий. */
  digits?: () => number;
  maxAttempts?: number;
};

export type CreatedOrder = {
  id: string;
  number: string;
  amountKzt: number;
  userId: string;
  accessDays: number | null;
  accessKey: string;
  /** true — у пользователя уже был неоплаченный заказ на курс, вернули его (новый не создан). */
  existing: boolean;
  /**
   * Только при existing: открытый заказ оформлен иначе, чем в этой форме (тип покупателя, способ
   * оплаты или БИН компании). Страница заказа скажет об этом и предложит отменить его (владельцу).
   */
  differs: boolean;
};

/** Отличается ли открытый заказ от данных новой формы — то, что меняет способ оплаты и документы. */
export function orderDiffersFrom(
  open: { buyerType: string; paymentMethod: string; companyBin: string | null },
  input: Pick<CheckoutInput, 'buyerType' | 'paymentMethod' | 'companyBin'>,
): boolean {
  if (open.buyerType !== input.buyerType || open.paymentMethod !== input.paymentMethod) return true;
  return input.buyerType === 'company' && (open.companyBin ?? null) !== (input.companyBin ?? null);
}

/** Ровно offer и pd_processing: иначе заказ создался бы с неполными согласиями. */
function assertCheckoutConsents(consents: readonly PreparedConsent[]): void {
  const kinds = consents.map((c) => c.kind).sort().join(',');
  if (kinds !== [...CHECKOUT_CONSENTS].sort().join(',')) throw new Error('ORDER_CONSENTS_INVALID');
}

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
 * Создать заказ вошедшего пользователя (D-020).
 * - Нет пользователя (гость или аккаунт удалён) → login_required. Пользователей по email не ищем.
 * - Курс не продаётся → not_for_sale; есть действующий доступ → has_access.
 * - Уже есть неоплаченный заказ на этот курс → возвращаем его (existing: true), второй не создаём;
 *   differs — он оформлен иначе (владелец может отменить его сам: cancelOwnOrder).
 * - buyer_email — email аккаунта (не из формы); сумма и срок доступа — из предложения курса.
 * - EMAIL_VERIFY активен и email аккаунта не подтверждён → email_unverified до любых записей.
 * Согласия offer и pd_processing — к заказу (только к новому: у existing новых согласий нет).
 */
export async function createOrder(input: CheckoutInput, opts: CreateOrderOptions): Promise<CreatedOrder> {
  if (typeof opts.userId !== 'string' || opts.userId === '') throw new OrderError('login_required');
  assertCheckoutConsents(opts.consents);
  const requireVerified = opts.requireVerifiedEmail ?? isFeatureActive('EMAIL_VERIFY');
  const db = await getDb();
  const digits = opts.digits ?? randomOrderDigits;
  const maxAttempts = opts.maxAttempts ?? 25;

  const created = await db.tx(async (sql) => {
    // строка пользователя блокируется: параллельные заказы одного пользователя идут по очереди,
    // и проверка «есть открытый заказ» не пропускает дубль
    const [user] = await sql<{ id: string; email: string; emailVerifiedAt: number | null }>`
      SELECT id, email, email_verified_at FROM users WHERE id = ${opts.userId} FOR UPDATE`;
    if (!user) throw new OrderError('login_required');
    // чужой email мог быть занят заранее (#25): заказ — только с подтверждённого, и до любых записей
    if (requireVerified && user.emailVerifiedAt === null) throw new OrderError('email_unverified');

    const sale = await getCourseForSale(input.courseSlug, sql);
    if (sale.kind !== 'ok') throw new OrderError('not_for_sale');
    const course = sale.course;

    if ((await canAccessCourse(user.id, course.id, sql)).ok) throw new OrderError('has_access');

    const open = await findOpenOrder(user.id, course.id, sql);
    if (open) {
      return {
        id: open.id,
        number: open.number,
        amountKzt: open.amountKzt,
        userId: user.id,
        accessDays: open.accessDays,
        existing: true,
        differs: orderDiffersFrom(open, input),
      };
    }

    const t = now();
    const id = newId();
    const amountKzt = course.priceKzt; // только из БД, никогда из формы
    const accessDays = course.accessDays; // снимок срока: оплата возьмёт его из заказа
    const number = await insertWithNumber(t, digits, maxAttempts, async (candidate) => {
      const rows = await sql`
        INSERT INTO orders (id, number, user_id, course_id, amount_kzt, access_days, status, buyer_type,
                            buyer_name, buyer_email, buyer_phone, company_name, company_bin, payment_method,
                            paid_at, decided_by, created_at, updated_at)
        VALUES (${id}, ${candidate}, ${user.id}, ${course.id}, ${amountKzt}, ${accessDays}, 'pending',
                ${input.buyerType}, ${input.name}, ${user.email}, ${input.phone}, ${input.companyName},
                ${input.companyBin}, ${input.paymentMethod}, NULL, NULL, ${t}, ${t})
        ON CONFLICT (number) DO NOTHING
        RETURNING id`;
      return rows.length > 0;
    });

    await insertConsents(sql, { userId: user.id, orderId: id, context: 'checkout', at: t, consents: opts.consents });
    // в журнал — без персональных данных покупателя
    await writeAudit(sql, {
      actorId: user.id,
      action: 'order.create',
      entity: 'order',
      entityId: id,
      meta: {
        number,
        courseId: course.id,
        amountKzt,
        accessDays,
        paymentMethod: input.paymentMethod,
        buyerType: input.buyerType,
      },
      createdAt: t,
    });
    return { id, number, amountKzt, userId: user.id, accessDays, existing: false, differs: false };
  });

  return { ...created, accessKey: orderAccessKey(created.id) };
}
