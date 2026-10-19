import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/auth';
import { t as tl } from '@/lib/content/l10n';
import { Link, redirect } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';
import { buyState, findOpenOrder, getCourseForSale } from '@/lib/orders/queries';
import { BuyStepsCard, CheckoutForm, OrderSummaryCard } from '@/components/checkout';
import { Alert, Breadcrumbs, Card, Container, PageHeader, Section } from '@/components/ui';
import '@/components/checkout/checkout.css';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const sale = await getCourseForSale(slug);
  const t = await getTranslations({ locale, namespace: 'checkout.buy' });
  const course = sale.kind === 'ok' ? tl(sale.course.title, locale) : '';
  return { title: t('metaTitle', { course }), robots: { index: false, follow: false } };
}

/**
 * Покупка курса (Фаза 0, D-007). Продаётся только опубликованный public-курс с активным
 * предложением и ценой > 0; иначе 404 или страница курса. Покупка — только после входа
 * (D-020): гостя ведём на вход с возвратом сюда. Есть доступ — сразу к обучению.
 */
export default async function BuyPage({ params }: Props) {
  const { locale: raw, slug } = await params;
  if (!hasLocale(routing.locales, raw)) notFound();
  const locale = raw;
  setRequestLocale(locale);

  const sale = await getCourseForSale(slug);
  if (sale.kind === 'missing') notFound();
  if (sale.kind === 'not_for_sale') return redirect({ href: `/courses/${sale.slug}`, locale });
  const course = sale.course;

  const user = await requireUser(locale, `/${locale}/courses/${course.slug}/buy`);
  if ((await buyState(user.id, course.id)) === 'has_access') {
    return redirect({ href: `/learn/${course.slug}`, locale });
  }
  const openOrder = await findOpenOrder(user.id, course.id);

  const t = await getTranslations('checkout.buy');
  const a11y = await getTranslations('common.a11y');
  const title = tl(course.title, locale);

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            label={a11y('breadcrumbs')}
            items={[
              { label: t('crumbs.courses'), href: '/courses' },
              { label: title, href: `/courses/${course.slug}` },
              { label: t('crumbs.checkout') },
            ]}
          />
        }
        title={title}
        lead={t('lead')}
      />
      <Section spacing="tight">
        <Container className="co-buy">
          <div className="co-buy__main">
            {openOrder && (
              <Alert tone="warning" title={t('openOrder.title', { number: openOrder.number })}>
                <p>
                  {t('openOrder.text')}{' '}
                  <Link href={`/orders/${openOrder.number}`} className="text-link">
                    {t('openOrder.action')}
                  </Link>
                </p>
              </Alert>
            )}
            <Card large padding="lg">
              <CheckoutForm
                courseSlug={course.slug}
                priceKzt={course.priceKzt}
                user={{ name: user.name, email: user.email }}
              />
            </Card>
          </div>
          <div className="co-buy__aside">
            <OrderSummaryCard course={course} locale={locale} />
            <BuyStepsCard />
          </div>
        </Container>
      </Section>
    </>
  );
}
