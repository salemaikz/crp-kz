import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isDemo } from '@/lib/env';
import { isFeatureActive } from '@/lib/features';
import { routing } from '@/lib/i18n/routing';
import { AuthShell } from '@/components/layout/AuthShell';
import { ForgotForm } from './ForgotForm';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'auth.forgot' });
  return { title: t('metaTitle'), referrer: 'no-referrer', robots: { index: false } };
}

export default async function ForgotPasswordPage({ params }: Props) {
  if (!isFeatureActive('PASSWORD_RESET')) notFound();
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <AuthShell title={t('forgot.title')} lead={t('forgot.lead')}>
      <ForgotForm demo={isDemo()} />
    </AuthShell>
  );
}
