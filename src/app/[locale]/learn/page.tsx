import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StubPage } from '@/components/layout';
import { routing } from '@/lib/i18n/routing';

// ВРЕМЕННАЯ ЗАГЛУШКА: страницу перепишет агент своей зоны (docs/lms/BUILD.md §12).
type Props = { params: Promise<{ locale: string }> };

async function resolve(params: Props['params']) {
  const { locale: raw } = await params;
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: await resolve(params), namespace: 'common' });
  return { title: t('nav.learn') };
}

export default async function Page({ params }: Props) {
  const locale = await resolve(params);
  setRequestLocale(locale);
  const t = await getTranslations('common');
  return <StubPage title={t('nav.learn')} />;
}
