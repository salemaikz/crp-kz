import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth';
import { t as tl } from '@/lib/content/l10n';
import { formatDate, formatPrice, intlLocale, TIME_ZONE } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';
import { isOrderNumber } from '@/lib/orders/number';
import { listOrders, orderStats, type OrderFilter } from '@/lib/orders/queries';
import { ORDER_STATUSES, type OrderView } from '@/lib/orders/types';
import { AdminOrderActions, OrderStatusBadge } from '@/components/checkout';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { AdminStat } from '@/components/admin/AdminStat';
import { Alert, Button, Chip, EmptyState, Table, type TableColumn } from '@/components/ui';
import '@/components/checkout/checkout.css';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTERS: OrderFilter[] = ['all', ...ORDER_STATUSES];
const NOTICES = [
  'paid',
  'cancelled',
  'refunded',
  'refunded_no_access',
  'already_paid',
  'no_user',
  'not_pending',
  'not_paid',
  'not_found',
  'invalid',
] as const;
type Notice = (typeof NOTICES)[number];
const SUCCESS: readonly Notice[] = ['paid', 'cancelled', 'refunded', 'refunded_no_access'];

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'checkout.admin' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Время заказа по Астане: «14:05». */
function formatTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Заказы для администратора: фильтр по статусу, «Оплачено» / «Отменить» / «Возврат». */
export default async function AdminOrdersPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!hasLocale(routing.locales, raw)) notFound();
  const locale = raw;
  setRequestLocale(locale);
  await requireAdmin(locale, `/${locale}/admin/orders`);

  const sp = await searchParams;
  const statusParam = one(sp.status);
  const filter: OrderFilter = FILTERS.includes(statusParam as OrderFilter) ? (statusParam as OrderFilter) : 'all';
  const noticeParam = one(sp.notice);
  const notice = NOTICES.includes(noticeParam as Notice) ? (noticeParam as Notice) : null;
  const orderParam = one(sp.order);
  const noticeNumber = orderParam && isOrderNumber(orderParam) ? orderParam : '';

  const [orders, stats] = await Promise.all([listOrders(filter), orderStats()]);
  const t = await getTranslations('checkout');
  const total = Object.values(stats).reduce((n, s) => n + s.count, 0);

  const columns: TableColumn<OrderView>[] = [
    {
      key: 'number',
      header: t('admin.columns.number'),
      primary: true,
      cell: (o) => (
        <>
          <Link
            href={`/orders/${o.number}`}
            className="co-order-link"
            aria-label={t('admin.openOrder', { number: o.number })}
          >
            {o.number}
          </Link>
          <span className="co-cell-meta num co-date">
            {formatDate(o.createdAt, locale, { short: true, omitCurrentYear: true })}, {formatTime(o.createdAt, locale)}
          </span>
        </>
      ),
    },
    {
      key: 'buyer',
      header: t('admin.columns.buyer'),
      width: '26%',
      cell: (o) => (
        <div className="co-buyer">
          <span className="co-buyer__name">{o.buyerName}</span>
          <span className="co-buyer__line" title={o.buyerEmail}>
            {o.buyerEmail}
          </span>
          <span className="co-buyer__line" title={o.buyerPhone}>
            {o.buyerPhone}
          </span>
          {o.buyerType === 'company' && o.companyName && (
            <span className="co-buyer__company">
              {o.companyName}
              {o.companyBin && <span className="co-cell-meta">{t('admin.bin', { bin: o.companyBin })}</span>}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'course',
      header: t('admin.columns.course'),
      width: '22%',
      cell: (o) => <span className="co-course-cell">{tl(o.courseTitle, locale)}</span>,
    },
    {
      key: 'amount',
      header: t('admin.columns.amount'),
      align: 'right',
      cell: (o) => (
        <>
          <strong className="num">{formatPrice(o.amountKzt, locale)}</strong>
          <span className="co-cell-meta">{t(`common.method.${o.paymentMethod}`)}</span>
        </>
      ),
    },
    {
      key: 'status',
      header: t('admin.columns.status'),
      cell: (o) => <OrderStatusBadge status={o.status} />,
    },
    {
      key: 'actions',
      header: t('admin.columns.actions'),
      mobileLabel: '',
      cell: (o) => (
        <AdminOrderActions
          key={`${o.id}:${o.status}`}
          orderId={o.id}
          number={o.number}
          email={o.buyerEmail}
          status={o.status}
          filter={filter}
        />
      ),
    },
  ];

  const countOf = (f: OrderFilter) => (f === 'all' ? total : stats[f].count);

  return (
    <>
      <AdminPageHead title={t('admin.title')} lead={t('admin.lead')} />

      <div className="adm-stats">
        <AdminStat
          tone={stats.pending.count > 0 ? 'red' : 'ink'}
          value={stats.pending.count}
          label={t('admin.stats.pending')}
          hint={t('admin.stats.sum', { amount: formatPrice(stats.pending.amountKzt, locale) })}
        />
        <AdminStat
          value={stats.paid.count}
          label={t('admin.stats.paid')}
          hint={t('admin.stats.sum', { amount: formatPrice(stats.paid.amountKzt, locale) })}
        />
        <AdminStat value={stats.refunded.count} label={t('admin.stats.refunded')} />
      </div>

      {notice && (
        <Alert tone={SUCCESS.includes(notice) ? 'success' : 'warning'} className="co-notice">
          {t(`admin.notice.${notice}`, { number: noticeNumber })}
        </Alert>
      )}
      <nav className="co-filters" aria-label={t('admin.filters.label')}>
        {FILTERS.map((f) => (
          <Chip key={f} href={f === 'all' ? '/admin/orders' : `/admin/orders?status=${f}`} active={f === filter}>
            {t(`admin.filters.${f}`)}
            <span className="co-filters__count">{countOf(f)}</span>
          </Chip>
        ))}
      </nav>
      {orders.length === 0 ? (
        <EmptyState
          title={t(`admin.empty.${filter}`)}
          description={t('admin.empty.text')}
          action={
            filter !== 'all' ? (
              <Button href="/admin/orders" variant="ghost">
                {t('admin.empty.reset')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table className="co-orders" columns={columns} rows={orders} rowKey={(o) => o.id} />
      )}
    </>
  );
}
