import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth';
import { t as tl } from '@/lib/content/l10n';
import { formatDate, formatPrice } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';
import { canViewOrder } from '@/lib/orders/access-key';
import { isOrderNumber } from '@/lib/orders/number';
import { getOrderByNumber } from '@/lib/orders/queries';
import { SELLER } from '@/lib/orders/types';
import { amountInWords } from '@/lib/orders/words';
import { PrintButton } from '@/components/checkout';
import { Alert, Container, Section } from '@/components/ui';
import '@/components/checkout/checkout.css';

type Props = {
  params: Promise<{ locale: string; number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, number } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'checkout.invoice' });
  return {
    title: t('metaTitle', { number: isOrderNumber(number) ? number : '' }),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/** Счёт на оплату (печатный HTML → PDF через печать браузера). Права — как у страницы заказа. */
export default async function InvoicePage({ params, searchParams }: Props) {
  const { locale: raw, number } = await params;
  if (!hasLocale(routing.locales, raw)) notFound();
  const locale = raw;
  setRequestLocale(locale);
  if (!isOrderNumber(number)) notFound();

  const sp = await searchParams;
  const key = typeof sp.key === 'string' ? sp.key : undefined;
  const [order, viewer] = await Promise.all([getOrderByNumber(number), getCurrentUser()]);
  if (!order || !canViewOrder(order, viewer, key)) notFound();

  const t = await getTranslations('checkout.invoice');
  const course = tl(order.courseTitle, locale);
  const amount = formatPrice(order.amountKzt, locale);
  const date = formatDate(order.createdAt, locale);
  const annulled = order.status === 'cancelled' || order.status === 'refunded';
  const company = order.buyerType === 'company' && order.companyName;
  const item = order.accessDays ? t('item', { course, days: order.accessDays }) : t('itemForever', { course });
  const backHref = `/orders/${order.number}${key ? `?key=${encodeURIComponent(key)}` : ''}`;

  return (
    <Section spacing="tight">
      <Container>
        <div className="co-invoice-wrap">
          <div className="co-toolbar co-noprint">
            <Link href={backHref} className="link-arrow">
              <ArrowLeft aria-hidden="true" />
              {t('back')}
            </Link>
            <div className="co-toolbar__print">
              <span className="co-toolbar__hint">{t('printHint')}</span>
              <PrintButton label={t('print')} />
            </div>
          </div>
          {annulled && (
            <Alert tone="warning" className="co-noprint">
              {t('annulled')}
            </Alert>
          )}

          <article className="co-invoice" aria-labelledby="invoice-title">
            {annulled && (
              <span className="co-stamp" aria-hidden="true">
                {t('stamp')}
              </span>
            )}
            <header className="co-invoice__head">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG-логотип для печати, без оптимизации */}
              <img className="co-invoice__logo" src="/brand/crp-logo.svg" alt={SELLER.name} width={168} height={35} />
              <div className="co-invoice__titlebox">
                <h1 id="invoice-title" className="co-invoice__title">
                  {t('title', { number: order.number })}
                </h1>
                <p className="co-invoice__date">{t('date', { date })}</p>
              </div>
            </header>

            <div className="co-parties">
              <section className="co-party" aria-label={t('seller')}>
                <span className="co-party__label">{t('seller')}</span>
                <span className="co-party__name">{SELLER.name}</span>
                <p className="co-party__line">
                  {t('bin')}: {SELLER.bin}
                </p>
                <p className="co-party__line">
                  {t('bank')}: <span className="co-party__placeholder">{t('bankPlaceholder')}</span>
                </p>
              </section>
              <section className="co-party" aria-label={t('buyer')}>
                <span className="co-party__label">{t('buyer')}</span>
                <span className="co-party__name">{company ? order.companyName : order.buyerName}</span>
                {company && order.companyBin && (
                  <p className="co-party__line">
                    {t('binOrIin')}: {order.companyBin}
                  </p>
                )}
                <p className="co-party__line">
                  {t('contact')}: {company ? `${order.buyerName}, ` : ''}
                  {order.buyerPhone}, {order.buyerEmail}
                </p>
              </section>
            </div>

            <div className="co-items-wrap">
              <table className="co-items">
                <thead>
                  <tr>
                    <th scope="col">{t('table.n')}</th>
                    <th scope="col">{t('table.name')}</th>
                    <th scope="col" className="co-num">
                      {t('table.qty')}
                    </th>
                    <th scope="col">{t('table.unit')}</th>
                    <th scope="col" className="co-num">
                      {t('table.price')}
                    </th>
                    <th scope="col" className="co-num">
                      {t('table.sum')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>{item}</td>
                    <td className="co-num">1</td>
                    <td>{t('unit')}</td>
                    <td className="co-num">{amount}</td>
                    <td className="co-num">{amount}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <dl className="co-totals">
              <div className="co-totals__row">
                <dt>{t('total')}</dt>
                <dd>{amount}</dd>
              </div>
              <div className="co-totals__row">
                <dt>{t('vat')}</dt>
                <dd>{t('vatValue')}</dd>
              </div>
              <div className="co-totals__row co-totals__grand">
                <dt>{t('toPay')}</dt>
                <dd>{amount}</dd>
              </div>
            </dl>

            <div className="co-words">
              <span>{t('summary', { amount })}</span>
              <strong>{amountInWords(order.amountKzt, locale)}</strong>
            </div>

            <ul className="co-terms">
              <li>{t('purpose', { number: order.number })}</li>
              <li>{t('terms')}</li>
            </ul>

            <div className="co-sign">
              <span>{t('signature')}</span>
              <span className="co-sign__line" aria-hidden="true" />
            </div>
          </article>
        </div>
      </Container>
    </Section>
  );
}
