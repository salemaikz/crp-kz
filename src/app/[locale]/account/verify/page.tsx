import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isFeatureActive } from '@/lib/features';
import { routing } from '@/lib/i18n/routing';
import { AuthShell } from '@/components/layout/AuthShell';
import { VerifyEmail } from './VerifyEmail';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'auth.verify' });
  return { title: t('metaTitle'), referrer: 'no-referrer', robots: { index: false } };
}

/** Подтверждение email по ссылке из письма. Страница открывается и без входа; на GET ничего не тратится. */
export default async function VerifyEmailPage({ params }: Props) {
  if (!isFeatureActive('EMAIL_VERIFY')) notFound();
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <AuthShell title={t('verify.title')} lead={t('verify.lead')}>
      <VerifyEmail />
    </AuthShell>
  );
}
