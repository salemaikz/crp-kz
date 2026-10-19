import type { Metadata } from 'next';
import { SearchX, ShieldCheck, Timer } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CertLookup } from '@/components/learn/CertLookup';
import { Button, Card, Container, EmptyState, PageHeader, Section } from '@/components/ui';
import { t as loc } from '@/lib/content/l10n';
import { formatDate } from '@/lib/format';
import { routing } from '@/lib/i18n/routing';
import { findCertificateByNumber } from '@/lib/learn/certificates';
import { certLookupAllowed, routeParam } from '@/lib/learn/server';
import '@/components/learn/learn.css';

type Props = { params: Promise<{ locale: string; number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'learn.meta' });
  // имена людей в поиск не отдаём
  return { title: t('verifyTitle'), robots: { index: false, follow: false } };
}

/** Публичная проверка сертификата по номеру: ФИО, курс, дата. Без входа; email не показывается и не читается. */
export default async function CertVerifyPage({ params }: Props) {
  const { locale: raw, number: rawNumber } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const number = routeParam(rawNumber).slice(0, 40);
  const t = await getTranslations('learn.verify');

  if (!(await certLookupAllowed(number))) {
    return (
      <>
        <PageHeader tone="night" title={t('tooMany.title')} lead={t('tooMany.description')} />
        <Section tone="board" spacing="tight">
          <Container size="narrow">
            <EmptyState icon={<Timer />} title={t('tooMany.title')} description={t('tooMany.description')} headingLevel="h2" />
          </Container>
        </Section>
      </>
    );
  }

  const cert = await findCertificateByNumber(number);

  if (!cert) {
    return (
      <>
        <PageHeader tone="night" title={t('invalid.title')} lead={t('invalid.lead', { number })} />
        <Section tone="board" spacing="tight">
          <Container size="narrow">
            <div className="lrn-block" data-testid="cert-invalid">
              <EmptyState
                icon={<SearchX />}
                title={t('invalid.cardTitle')}
                description={t('invalid.hint')}
                headingLevel="h2"
              />
            </div>
            <Card large className="lrn-verify">
              <CertLookup locale={locale} defaultValue={number} />
            </Card>
          </Container>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader tone="night" title={t('valid.title')} lead={t('valid.lead')} />
      <Section tone="board" spacing="tight">
        <Container size="narrow">
          <Card large padding="none" className="lrn-verify" data-testid="cert-valid">
            <p className="lrn-verify__seal">
              <span className="lrn-verify__seal-icon" aria-hidden="true">
                <ShieldCheck />
              </span>
              {t('valid.seal')}
            </p>
            <dl className="lrn-verify__list">
              <div className="lrn-verify__row lrn-verify__row--name">
                <dt>{t('fields.holder')}</dt>
                <dd data-testid="cert-holder">{cert.holderName}</dd>
              </div>
              <div className="lrn-verify__row">
                <dt>{t('fields.course')}</dt>
                <dd>{loc(cert.courseTitle, locale)}</dd>
              </div>
              <div className="lrn-verify__row">
                <dt>{t('fields.issued')}</dt>
                <dd>{formatDate(cert.issuedAt, locale)}</dd>
              </div>
              <div className="lrn-verify__row">
                <dt>{t('fields.number')}</dt>
                <dd>{cert.number}</dd>
              </div>
            </dl>
            <p className="meta">{t('valid.note')}</p>
            <div>
              <Button href="/courses" variant="ghost">
                {t('toCatalog')}
              </Button>
            </div>
          </Card>
        </Container>
      </Section>
    </>
  );
}
