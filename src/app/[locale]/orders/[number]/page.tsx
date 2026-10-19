import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { enrollmentState } from '@/lib/access';
import { getCurrentUser } from '@/lib/auth';
import { t as tl } from '@/lib/content/l10n';
import { isDemo } from '@/lib/env';
import { formatDate, formatPrice } from '@/lib/format';
import { routing } from '@/lib/i18n/routing';
import { canViewOrder } from '@/lib/orders/access-key';
import { isOrderNumber } from '@/lib/orders/number';
import { getOrderByNumber, orderEnrollment } from '@/lib/orders/queries';
import {
  ClosedResult,
  DemoAdminHint,
  HelpCard,
  InvoicePayment,
  KaspiPayment,
  OrderDetails,
  OrderStatusBadge,
  OwnerCancelOrder,
  PaidResult,
} from '@/components/checkout';
import { Alert, Breadcrumbs, Container, PageHeader, Price, Section } from '@/components/ui';
import '@/components/checkout/checkout.css';

/** Плашки страницы заказа для владельца (?notice=…): см. createOrderAction и cancelOwnOrderAction. */
const OWNER_NOTICES = new Set(['existing', 'existing_differs', 'cancelled_by_owner', 'cancel_refused']);
const NOTICE_TONE: Record<string, 'info' | 'warning' | 'success' | 'error'> = {
  existing: 'info',
  existing_differs: 'warning',
  cancelled_by_owner: 'success',
  cancel_refused: 'error',
};

type Props = {
  params: Promise<{ locale: string; number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Страница приватная: не индексируем и не отдаём ключ из адреса в Referer
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, number } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'checkout.order' });
  return {
    title: t('metaTitle', { number: isOrderNumber(number) ? number : '' }),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/**
 * Статус заказа и инструкция по оплате. Открыть может владелец (вошёл под аккаунтом заказа),
 * администратор или держатель ключа из ссылки (?key=). Остальным — 404.
 */
export default async function OrderPage({ params, searchParams }: Props) {
  const { locale: raw, number } = await params;
  if (!hasLocale(routing.locales, raw)) notFound();
  const locale = raw;
  setRequestLocale(locale);
  if (!isOrderNumber(number)) notFound();

  const sp = await searchParams;
  const key = typeof sp.key === 'string' ? sp.key : undefined;
  const [order, viewer] = await Promise.all([getOrderByNumber(number), getCurrentUser()]);
  if (!order || !canViewOrder(order, viewer, key)) notFound();

  const t = await getTranslations('checkout.order');
  const a11y = await getTranslations('common.a11y');
  const buyT = await getTranslations('checkout.buy.crumbs');
  const course = tl(order.courseTitle, locale);
  const amount = formatPrice(order.amountKzt, locale);
  const variant = order.status === 'pending' ? `pending_${order.paymentMethod}` : order.status;
  const isOwner = !!viewer && viewer.id === order.userId;
  const keyQuery = key ? `?key=${encodeURIComponent(key)}` : '';
  const invoiceHref = `/orders/${order.number}/invoice${keyQuery}`;
  // плашки после действий владельца: открыт уже существующий заказ, заказ отменён им самим
  const notice = isOwner && typeof sp.notice === 'string' && OWNER_NOTICES.has(sp.notice) ? sp.notice : null;
  // плашка — только пока она верна: «открыт существующий» — у неоплаченного, «отменён» — у отменённого
  const showNotice =
    notice === 'cancel_refused' ||
    (notice === 'cancelled_by_owner' && order.status === 'cancelled') ||
    ((notice === 'existing' || notice === 'existing_differs') && order.status === 'pending');

  let paid: ReactNode = null;
  if (order.status === 'paid') {
    const enrollment = await orderEnrollment(order);
    const state = enrollmentState(enrollment);
    paid = (
      <PaidResult
        order={order}
        locale={locale}
        access={state.ok ? { state: 'active', expiresAt: enrollment?.expiresAt ?? null } : { state: 'closed' }}
        cta={isOwner ? 'learn' : 'signin'}
        signInHref={`/login?next=${encodeURIComponent(`/${locale}/learn/${order.courseSlug}`)}`}
      />
    );
  }

  return (
    <>
      <PageHeader
        tone="night"
        breadcrumbs={
          <Breadcrumbs
            label={a11y('breadcrumbs')}
            items={[
              { label: buyT('courses'), href: '/courses' },
              { label: course, href: `/courses/${order.courseSlug}` },
              { label: t('crumb', { number: order.number }) },
            ]}
          />
        }
        title={t(`title.${variant}`)}
        lead={t(`lead.${variant}`, { amount, course })}
        meta={
          <div className="co-header-meta">
            <OrderStatusBadge status={order.status} />
            <Price kzt={order.amountKzt} size="md" />
            <span className="meta">{formatDate(order.createdAt, locale, { withTime: true })}</span>
          </div>
        }
      />
      <Section spacing="tight">
        <Container className="co-order">
          <div className="co-order__main">
            {showNotice && notice && (
              <Alert tone={NOTICE_TONE[notice]} data-testid="order-notice">
                {t(`notice.${notice}`)}
              </Alert>
            )}
            {order.status === 'pending' && (
              <>
                {order.paymentMethod === 'kaspi' ? (
                  <KaspiPayment order={order} locale={locale} />
                ) : (
                  <InvoicePayment order={order} locale={locale} invoiceHref={invoiceHref} />
                )}
                {!isOwner && key && <Alert tone="info">{t('saveLink')}</Alert>}
                {isOwner && <OwnerCancelOrder orderId={order.id} number={order.number} />}
                {isDemo() && <DemoAdminHint locale={locale} viewerIsAdmin={viewer?.role === 'admin'} />}
              </>
            )}
            {paid}
            {(order.status === 'cancelled' || order.status === 'refunded') && <ClosedResult order={order} />}
          </div>
          <aside className="co-order__aside">
            <OrderDetails order={order} locale={locale} />
            <HelpCard />
          </aside>
        </Container>
      </Section>
    </>
  );
}
