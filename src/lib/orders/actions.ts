'use server';
// Server actions покупки и админки заказов — тонкие: проверка прав, zod, лимит, вызов логики из ./create и ./admin.
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getCurrentUser } from '../auth';
import { rateLimit } from '../auth/rateLimit';
import { redirect } from '../i18n/navigation';
import { cancelOrder, markPaid, refundOrder } from './admin';
import { createOrder } from './create';
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

/** Лимит заказов с одного IP: защита от спама заказами и перебора. */
const ORDER_LIMIT = { limit: 10, windowMs: 60 * 60_000 };

function localeOf(fd: FormData): 'ru' | 'kz' {
  return fd.get('locale') === 'kz' ? 'kz' : 'ru';
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'local';
  return ip.slice(0, 64);
}

/** Оформление заказа: проверка формы → лимит → заказ → страница заказа с ключом доступа. */
export async function createOrderAction(prev: CheckoutFormState, formData: FormData): Promise<CheckoutFormState> {
  const locale = localeOf(formData);
  const attempt = (prev?.attempt ?? 0) + 1;
  const raw = Object.fromEntries(CHECKOUT_FIELDS.map((f) => [f, formData.get(f)]));
  const parsed = parseCheckout(raw);
  if (!parsed.ok) return { attempt, error: 'validation', errors: parsed.errors, values: parsed.values };

  const ip = await clientIp();
  if (!rateLimit(`order:${ip}`, ORDER_LIMIT.limit, ORDER_LIMIT.windowMs).ok) {
    return { attempt, error: 'rate_limited', values: parsed.values };
  }

  const user = await getCurrentUser();
  let target: { pathname: string; query?: Record<string, string> } | null = null;
  try {
    const created = await createOrder(parsed.data, { userId: user?.id ?? null });
    target = { pathname: `/orders/${created.number}`, query: { key: created.accessKey } };
  } catch (e) {
    if (e instanceof OrderError && e.code === 'has_access') {
      target = { pathname: `/learn/${parsed.data.courseSlug}` };
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
  if (op === 'paid') return res.userCreated ? 'paid_new_user' : 'paid';
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
