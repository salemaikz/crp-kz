import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { routing } from '@/lib/i18n/routing';
import { isLegalEnabled, legalAllowDrafts } from '@/lib/legal/consents';
import { currentVersion, visibleVersions } from '@/lib/legal/registry';
import { loadLegalText } from '@/lib/legal/texts';
import { docKindFromSlug } from '@/lib/legal/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; doc: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, doc } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const kind = docKindFromSlug(doc);
  if (!kind || !isLegalEnabled()) return {};
  const t = await getTranslations({ locale, namespace: 'legal' });
  const v = currentVersion(kind, { allowDrafts: legalAllowDrafts() });
  // черновики в поиск не отдаём
  return { title: t(`docs.${kind}`), robots: v?.draft ? { index: false } : undefined };
}

/** Действующая редакция документа. Неизвестный документ, нет версии или LEGAL неактивен — 404. */
export default async function LegalDocPage({ params }: Props) {
  const { locale: raw, doc } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  if (!isLegalEnabled()) notFound();
  const kind = docKindFromSlug(doc);
  if (!kind) notFound();

  const allowDrafts = legalAllowDrafts();
  const v = currentVersion(kind, { allowDrafts });
  if (!v) notFound();

  const text = await loadLegalText(v, locale);
  const history = visibleVersions(kind, { allowDrafts })
    .filter((x) => x.version !== v.version)
    .map((x) => ({ version: x.version, effectiveFrom: x.effectiveFrom }));
  return <LegalDocument text={text} locale={locale} history={history} />;
}
