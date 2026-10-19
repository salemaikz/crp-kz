import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CertLookup } from '@/components/learn/CertLookup';
import { Card, Container, PageHeader, Section } from '@/components/ui';
import { routing } from '@/lib/i18n/routing';
import '@/components/learn/learn.css';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'learn.meta' });
  return { title: t('verifyTitle') };
}

/** Проверка сертификата: ввод номера (QR на сертификате ведёт сразу на /cert/<номер>). */
export default async function CertIndexPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations('learn.verify');
  return (
    <>
      <PageHeader tone="night" title={t('index.title')} lead={t('index.lead')} />
      <Section tone="board" spacing="tight">
        <Container size="narrow">
          <Card large className="lrn-verify">
            <CertLookup locale={locale} />
          </Card>
        </Container>
      </Section>
    </>
  );
}
