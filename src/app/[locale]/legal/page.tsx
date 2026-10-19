import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Badge, Container, PageHeader, Section } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { routing } from '@/lib/i18n/routing';
import { Link } from '@/lib/i18n/navigation';
import { versionDateMs } from '@/lib/legal/dates';
import { currentVersion } from '@/lib/legal/registry';
import { isLegalEnabled, legalAllowDrafts } from '@/lib/legal/consents';
import { LEGAL_DOC_KINDS, LEGAL_DOC_SLUG } from '@/lib/legal/types';
import '@/components/legal/legal.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t('index.title') };
}

/** Список документов: название, редакция, пометка черновика. Флаг LEGAL выключен — 404. */
export default async function LegalIndexPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  if (!isLegalEnabled()) notFound();

  const t = await getTranslations('legal');
  const allowDrafts = legalAllowDrafts();
  const rows = LEGAL_DOC_KINDS.flatMap((kind) => {
    const v = currentVersion(kind, { allowDrafts });
    return v ? [{ kind, v }] : [];
  });

  return (
    <>
      <PageHeader title={t('index.title')} lead={t('index.lead')} />
      <Section tone="board" spacing="tight">
        <Container>
          <ul className="legal-list">
            {rows.map(({ kind, v }) => (
              <li key={kind} className="legal-list__item">
                <Link href={`/legal/${LEGAL_DOC_SLUG[kind]}`} className="legal-list__title">
                  {t(`docs.${kind}`)}
                </Link>
                <span className="legal-list__meta">
                  {v.draft && <Badge tone="warning">{t('doc.draftBadge')}</Badge>}
                  {t('doc.edition', { date: formatDate(versionDateMs(v.effectiveFrom), locale) })}
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </>
  );
}
