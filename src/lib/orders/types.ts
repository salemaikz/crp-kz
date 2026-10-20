// Заказы (покупка, Фаза 0 по D-007): общие типы и константы. Нормативно: docs/lms/BUILD.md §3, §6; SPEC.md §3.

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const BUYER_TYPES = ['person', 'company'] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export const PAYMENT_METHODS = ['kaspi', 'invoice'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Продавец в инструкциях и счёте. БИН — публичные сведения ЦРП. */
export const SELLER = {
  name: 'ТОО «Центр развития предпринимателей»',
  bin: '141240000394',
} as const;

/** Локализованное поле из jsonb ({ru, kz}). */
export type L10nField = Record<string, string | undefined>;

/** Строка таблицы orders (camelCase). */
export type Order = {
  id: string;
  number: string;
  userId: string | null;
  courseId: string;
  amountKzt: number;
  status: OrderStatus;
  buyerType: BuyerType;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  companyName: string | null;
  companyBin: string | null;
  paymentMethod: PaymentMethod;
  /** Срок доступа в днях, зафиксированный при оформлении (D-020); null — бессрочно. */
  accessDays: number | null;
  paidAt: number | null;
  decidedBy: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Заказ с данными курса — для страниц статуса, счёта и админки. Срок доступа — из заказа. */
export type OrderView = Order & {
  courseSlug: string;
  courseTitle: L10nField;
};

/** Курс, который можно купить: опубликован, public, активное предложение с ценой > 0. */
export type BuyableCourse = {
  id: string;
  slug: string;
  title: L10nField;
  summary: L10nField;
  level: string | null;
  durationMin: number;
  priceKzt: number;
  accessDays: number | null;
  modulesCount: number;
  lessonsCount: number;
};

export type OrderErrorCode =
  | 'login_required'
  | 'not_for_sale'
  | 'has_access'
  | 'number_exhausted'
  /** Email аккаунта не подтверждён (D-032, предложено, ждёт владельца): работает только при EMAIL_VERIFY. */
  | 'email_unverified';

/** Ожидаемая ошибка бизнес-логики заказа (не баг): показываем пользователю понятный текст. */
export class OrderError extends Error {
  constructor(readonly code: OrderErrorCode) {
    super(`ORDER_${code.toUpperCase()}`);
    this.name = 'OrderError';
  }
}

/** Результат действия администратора над заказом. */
export type OrderDecision =
  | {
      ok: true;
      order: Order;
      userId?: string;
      /** Возврат: доступ по этому заказу закрыт. */
      accessRevoked?: boolean;
      /** Возврат: доступ держался на этом заказе и перешёл на другой оплаченный заказ (его номер). */
      accessMovedTo?: string;
    }
  | {
      ok: false;
      /** no_user — у заказа нет аккаунта покупателя (аккаунт удалён): оплату не отмечаем. */
      reason: 'not_found' | 'already_paid' | 'not_pending' | 'not_paid' | 'no_user';
      status?: OrderStatus;
    };
