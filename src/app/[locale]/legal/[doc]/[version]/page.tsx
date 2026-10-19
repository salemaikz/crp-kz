import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { routing } from '@/lib/i18n/routing';
import { isLegalEnabled, legalAllowDrafts } from '@/lib/legal/consents';
import { currentVersion, findVersion, visibleVersions } from '@/lib/legal/registry';
import { loadLegalText } from '@/lib/legal/texts';
import { docKindFromSlug, type LegalDocKind, type LegalVersion } from '@/lib/legal/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; doc: string; version: string }> };

/** Версия из реестра, видимая сейчас; иначе null (не найдена, будущая, черновик вне демо). */
function resolve(docSlug: string, versionParam: string): { kind: LegalDocKind; v: LegalVersion } | null {
  const kind = docKindFromSlug(docSlug);
  if (!kind || !isLegalEnabled()) return null;
  const v = findVersion(kind, versionParam);
  if (!v) return null;
  const visible = visibleVersions(kind, { allowDrafts: legalAllowDrafts() });
  return visible.some((x) => x.version === v.version) ? { kind, v } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, doc, version } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const found = resolve(doc, version);
  if (!found) return {};
  const t = await getTranslations({ locale, namespace: 'legal' });
  // архивные редакции в поиск не отдаём
  return { title: t(`docs.${found.kind}`), robots: { index: false } };
}

/** Архивная (или любая видимая) редакция документа по номеру версии. */
export default async function LegalVersionPage({ params }: Props) {
  const { locale: raw, doc, version } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const found = resolve(doc, version);
  if (!found) notFound();
  const { kind, v } = found;

  const allowDrafts = legalAllowDrafts();
  const visible = visibleVersions(kind, { allowDrafts });
  const isCurrent = currentVersion(kind, { allowDrafts })?.version === v.version;
  // действовала до даты, с которой вступила ближайшая более новая редакция
  const newer = visible[visible.findIndex((x) => x.version === v.version) - 1];
  const text = await loadLegalText(v, locale);
  const history = visible
    .filter((x) => x.version !== v.version)
    .map((x) => ({ version: x.version, effectiveFrom: x.effectiveFrom }));
  return <LegalDocument text={text} locale={locale} history={history} archivedUntil={isCurrent ? undefined : newer?.effectiveFrom} />;
}
