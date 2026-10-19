import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoBanner, Footer, Header } from '@/components/layout';
import { htmlLang } from '@/lib/content/l10n';
import { siteUrl } from '@/lib/env';
import { routing } from '@/lib/i18n/routing';
import { fontVariables } from '@/styles/fonts';
import '../globals.css';

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: '#0b0f17',
  colorScheme: 'light',
};

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    metadataBase: new URL(siteUrl()),
    title: { template: t('meta.titleTemplate'), default: t('meta.defaultTitle') },
    description: t('meta.description'),
    applicationName: t('brand.name'),
    openGraph: {
      type: 'website',
      siteName: t('brand.name'),
      locale: locale === 'kz' ? 'kk_KZ' : 'ru_RU',
    },
    // иконка — src/app/icon.png (файловая конвенция Next)
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('common.a11y');

  return (
    <html lang={htmlLang(locale)} className={fontVariables} data-scroll-behavior="smooth">
      <body>
        <a href="#main" className="skip-link">
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider>
          <DemoBanner />
          <Header />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
