import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CertificatePdfLink } from '@/components/learn/CertificatePdfLink';
import { CertificateSheet } from '@/components/learn/CertificateSheet';
import { CompletionCard } from '@/components/learn/CompletionCard';
import { PrintButton } from '@/components/learn/PrintButton';
import { Button, Container, PageHeader, Section, TextLink } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { t as loc } from '@/lib/content/l10n';
import { siteUrl } from '@/lib/env';
import { isFeatureActive } from '@/lib/features';
import { redirect } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';
import { getCertificate } from '@/lib/learn/certificates';
import { getCourse } from '@/lib/learn/data';
import { certificateVerifyUrl, qrDataUri } from '@/lib/learn/qr';
import { coursePath, getCourseAccess, routeParam } from '@/lib/learn/server';
import '@/components/learn/learn.css';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'learn.meta' });
  return { title: t('certificateTitle'), robots: { index: false } };
}

/** Размер и поля листа для печати: A4 альбомный без полей. @page — глобальное правило, поэтому только на этой странице. */
const PRINT_PAGE_CSS = '@page { size: A4 landscape; margin: 0; }';

export default async function CertificatePage({ params }: Props) {
  const { locale: raw, slug: rawSlug } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const slug = routeParam(rawSlug);

  const user = await requireUser(locale, `/${locale}/learn/${rawSlug}/certificate`);
  const course = await getCourse({ slug });
  if (!course || course.status !== 'published') notFound();

  const t = await getTranslations('learn.certificate');
  const certificate = await getCertificate(user.id, course.id);

  if (!certificate) {
    // выдача — только действием пользователя (GET ничего не меняет)
    const access = await getCourseAccess(user.id, slug);
    if (access.status !== 'ok' || !access.progress.complete) redirect({ href: coursePath(slug), locale });
    return (
      <>
        <PageHeader title={t('ready.title')} lead={t('ready.lead')} />
        <Section tone="board" spacing="tight">
          <Container size="narrow">
            <CompletionCard
              courseId={course.id}
              courseTitle={loc(course.title, locale)}
              lessonsCount={access.status === 'ok' ? access.progress.total : 0}
              locale={locale}
              certificateNumber={null}
              courseHref={coursePath(slug)}
              certificateHref={`${coursePath(slug)}/certificate`}
            />
          </Container>
        </Section>
      </>
    );
  }

  // при CERT_PDF — ссылка на файл, иначе прежняя печать браузером
  const pdfActive = isFeatureActive('CERT_PDF');
  const pdfHref = `/${locale}${coursePath(slug)}/certificate/pdf`;

  // сертификат печатается на языке, на котором проходили курс
  const site = siteUrl();
  const verifyUrl = certificateVerifyUrl(site, certificate.locale, certificate.number);
  const qrSrc = await qrDataUri(verifyUrl);
  const verifyHost = `${new URL(site).host}/${certificate.locale}/cert`;

  return (
    <>
      <style>{PRINT_PAGE_CSS}</style>
      <Section tone="board" spacing="none" className="lrn-cert-stage">
        <Container>
          <div className="lrn-cert-toolbar lrn-noprint">
            <div className="lrn-cert-toolbar__head">
              <h1 className="display">{t('title')}</h1>
            </div>
            <div className="lrn-cert-toolbar__actions">
              <Button href={coursePath(slug)} variant="ghost">
                {t('back')}
              </Button>
              {pdfActive ? (
                <CertificatePdfLink href={pdfHref} testId="download-certificate-pdf">
                  {t('download')}
                </CertificatePdfLink>
              ) : (
                <PrintButton />
              )}
            </div>
          </div>

          <CertificateSheet
            holderName={certificate.holderName}
            courseTitle={loc(course.title, certificate.locale)}
            issuedAt={certificate.issuedAt}
            number={certificate.number}
            locale={certificate.locale}
            qrSrc={qrSrc}
            verifyHost={verifyHost}
          />

          <div className="lrn-noprint">
            <p className="lrn-cert-hint">{pdfActive ? t('pdfHint') : t('printHint')}</p>
            <p className="lrn-cert-hint">
              <TextLink href={`/cert/${encodeURIComponent(certificate.number)}`}>{t('verifyLink')}</TextLink>
            </p>
          </div>
        </Container>
      </Section>
    </>
  );
}
