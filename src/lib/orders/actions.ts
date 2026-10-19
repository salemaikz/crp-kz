'use server';
// Server actions покупки и админки заказов — тонкие: проверка прав, zod, лимит, вызов логики из ./create и ./admin.
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getCurrentUser } from '../auth';
import { deriveClientIp } from '../auth/clientIp';
import { redirect } from '../i18n/navigation';
import { cancelOrder, markPaid, refundOrder } from './admin';
import { createOrder } from './create';
import { orderAllowed } from './limits';
import { isOrderNumber } from './number';
import { cancelOwnOrder } from './owner';
import { OrderError, ORDER_STATUSES, type OrderDecision } from './types';
import { CHECKOUT_FIELDS, parseCheckout, type CheckoutErrors, type CheckoutValues } from './validation';

export type CheckoutFormState =
  | {
      /** Номер попытки: форма перемонтируется и берёт значения из values. */
      attempt: number;
      error: 'validation' | 'rate_limited' | 'not_for_sale' | 'unknown';
      errors?: CheckoutErrors;
      values: CheckoutValues;
    }
  | undefined;

function localeOf(fd: FormData): 'ru' | 'kz' {
  return fd.get('locale') === 'kz' ? 'kz' : 'ru';
}

/**
 * Оформление заказа — только вошедшему (D-020): форма → лимит → заказ на аккаунт из сессии →
 * страница заказа с ключом доступа. Гостя — на вход с возвратом к покупке.
 * Email заказа — email аккаунта: значение поля формы не используется.
 */
export async function createOrderAction(prev: CheckoutFormState, formData: FormData): Promise<CheckoutFormState> {
  const locale = localeOf(formData);
  const attempt = (prev?.attempt ?? 0) + 1;
  const raw: Record<string, unknown> = Object.fromEntries(CHECKOUT_FIELDS.map((f) => [f, formData.get(f)]));

  const user = await getCurrentUser();
  if (!user) {
    const slug = typeof raw.courseSlug === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(raw.courseSlug) ? raw.courseSlug : null;
    const next = slug ? `/${locale}/courses/${slug}/buy` : `/${locale}/courses`;
    return redirect({ href: { pathname: '/login', query: { next } }, locale });
  }
  raw.email = user.email;

  const parsed = parseCheckout(raw);
  if (!parsed.ok) return { attempt, error: 'validation', errors: parsed.errors, values: parsed.values };

  if (!orderAllowed(user.id, deriveClientIp(await headers()))) {
    return { attempt, error: 'rate_limited', values: parsed.values };
  }

  let target: { pathname: string; query?: Record<string, string> } | null = null;
  try {
    const created = await createOrder(parsed.data, { userId: user.id });
    const query: Record<string, string> = { key: created.accessKey };
    // открыт уже существующий заказ: страница скажет об этом, а если он оформлен иначе —
    // предложит отменить его и оформить заново
    if (created.existing) query.notice = created.differs ? 'existing_differs' : 'existing';
    target = { pathname: `/orders/${created.number}`, query };
  } catch (e) {
    if (e instanceof OrderError && e.code === 'has_access') {
      target = { pathname: `/learn/${parsed.data.courseSlug}` };
    } else if (e instanceof OrderError && e.code === 'login_required') {
      target = { pathname: '/login', query: { next: `/${locale}/courses/${parsed.data.courseSlug}/buy` } };
    } else if (e instanceof OrderError && e.code === 'not_for_sale') {
      return { attempt, error: 'not_for_sale', values: parsed.values };
    } else {
      console.error('[orders] create failed:', e instanceof Error ? e.message : e);
      return { attempt, error: 'unknown', values: parsed.values };
    }
  }
  // redirect бросает исключение — вызываем вне try
  return redirect({ href: target, locale });
}

const FILTERS = ['all', ...ORDER_STATUSES] as const;

const adminActionSchema = z.object({
  orderId: z.string().min(1).max(64),
  op: z.enum(['paid', 'cancel', 'refund']),
  filter: z.enum(FILTERS).catch('all'),
});

function noticeOf(op: 'paid' | 'cancel' | 'refund', res: OrderDecision): string {
  if (!res.ok) return res.reason;
  if (op === 'paid') return 'paid';
  if (op === 'cancel') return 'cancelled';
  return res.accessRevoked ? 'refunded' : 'refunded_no_access';
}

/** Действие администратора над заказом; результат — плашкой на странице заказов (?notice=…). */
export async function adminOrderAction(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') notFound();

  const parsed = adminActionSchema.safeParse({
    orderId: formData.get('orderId'),
    op: formData.get('op'),
    filter: formData.get('filter'),
  });
  if (!parsed.success) {
    redirect({ href: { pathname: '/admin/orders', query: { notice: 'invalid' } }, locale });
    return;
  }
  const { orderId, op, filter } = parsed.data;
  const res =
    op === 'paid'
      ? await markPaid(orderId, user.id)
      : op === 'cancel'
        ? await cancelOrder(orderId, user.id)
        : await refundOrder(orderId, user.id);

  revalidatePath('/[locale]/admin/orders', 'page');
  revalidatePath('/[locale]/orders/[number]', 'page');
  const query: Record<string, string> = { notice: noticeOf(op, res) };
  if (filter !== 'all') query.status = filter;
  if (res.ok) query.order = res.order.number;
  redirect({ href: { pathname: '/admin/orders', query }, locale });
}

const ownerCancelSchema = z.object({
  orderId: z.string().min(1).max(64),
  number: z.string().max(40).refine(isOrderNumber),
});

/**
 * Покупатель отменяет свой неоплаченный заказ (pending → cancelled), чтобы оформить новый.
 * Только по сессии владельца: ключ из ссылки права отмены не даёт. Журнал: order.cancel_by_owner.
 */
export async function cancelOwnOrderAction(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const parsed = ownerCancelSchema.safeParse({ orderId: formData.get('orderId'), number: formData.get('number') });
  if (!parsed.success) notFound();
  const { orderId, number } = parsed.data;

  const user = await getCurrentUser();
  if (!user) {
    redirect({ href: { pathname: '/login', query: { next: `/${locale}/orders/${number}` } }, locale });
    return;
  }
  const res = await cancelOwnOrder(orderId, user.id);
  if (!res.ok && res.reason === 'not_found') notFound();

  revalidatePath('/[locale]/orders/[number]', 'page');
  revalidatePath('/[locale]/admin/orders', 'page');
  const notice = res.ok ? 'cancelled_by_owner' : 'cancel_refused';
  redirect({ href: { pathname: `/orders/${res.ok ? res.order.number : number}`, query: { notice } }, locale });
}
