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
import { getOrderByNumber, orderEnrollment, userCanSignIn } from '@/lib/orders/queries';
import {
  ClosedResult,
  DemoAdminHint,
  HelpCard,
  InvoicePayment,
  KaspiPayment,
  OrderDetails,
  OrderStatusBadge,
  PaidResult,
} from '@/components/checkout';
import { Alert, Breadcrumbs, Container, PageHeader, Price, Section } from '@/components/ui';
import '@/components/checkout/checkout.css';

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

  let paid: ReactNode = null;
  if (order.status === 'paid') {
    const [enrollment, canSignIn] = await Promise.all([
      orderEnrollment(order),
      order.userId ? userCanSignIn(order.userId) : Promise.resolve(false),
    ]);
    const state = enrollmentState(enrollment);
    paid = (
      <PaidResult
        order={order}
        locale={locale}
        access={state.ok ? { state: 'active', expiresAt: enrollment?.expiresAt ?? null } : { state: 'closed' }}
        cta={isOwner ? 'learn' : canSignIn ? 'signin' : 'no_account'}
        signInHref={`/login?next=${encodeURIComponent(`/${locale}/learn/${order.courseSlug}`)}`}
        demo={isDemo()}
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
        eyebrow={t('eyebrow', { number: order.number })}
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
            {order.status === 'pending' && (
              <>
                {order.paymentMethod === 'kaspi' ? (
                  <KaspiPayment order={order} locale={locale} />
                ) : (
                  <InvoicePayment order={order} locale={locale} invoiceHref={invoiceHref} />
                )}
                {!isOwner && key && <Alert tone="info">{t('saveLink')}</Alert>}
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
