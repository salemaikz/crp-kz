import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isFeatureActive } from '@/lib/features';
import { routing } from '@/lib/i18n/routing';
import { AuthShell } from '@/components/layout/AuthShell';
import { ResetForm } from './ResetForm';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'auth.reset' });
  // ссылка из письма: токен не должен уходить в Referer, страница не для поисковиков
  return { title: t('metaTitle'), referrer: 'no-referrer', robots: { index: false } };
}

export default async function ResetPasswordPage({ params }: Props) {
  if (!isFeatureActive('PASSWORD_RESET')) notFound();
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <AuthShell title={t('reset.title')} lead={t('reset.lead')}>
      <ResetForm />
    </AuthShell>
  );
}
