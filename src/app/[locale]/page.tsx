import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FeaturedCourses, FinalCta, HowItWorks, TeamsBlock } from '@/components/catalog/home/HomeSections';
import { HomeHero } from '@/components/catalog/home/HomeHero';
import { getCurrentUser, getMemberships } from '@/lib/auth';
import { getCatalogStats, getViewerStates, listFeaturedCourses } from '@/lib/catalog/queries';
import { localeAlternates } from '@/lib/catalog/seo';
import type { Locale } from '@/lib/content/types';
import { routing } from '@/lib/i18n/routing';

type Props = { params: Promise<{ locale: string }> };

async function resolveLocale(params: Props['params']): Promise<Locale> {
  const { locale: raw } = await params;
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    title: { absolute: t('meta.defaultTitle') },
    description: t('meta.description'),
    alternates: localeAlternates(locale, ''),
  };
}

/** Лендинг академии: первый экран, витрина курсов, как проходит обучение, команды, призыв. */
export default async function HomePage({ params }: Props) {
  const locale = await resolveLocale(params);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  const [memberships, stats, featured] = await Promise.all([
    user ? getMemberships(user.id) : Promise.resolve([]),
    getCatalogStats(),
    listFeaturedCourses(3),
  ]);
  const states = user ? await getViewerStates(user.id, featured) : undefined;
  const viewer = !user ? 'guest' : memberships.some((m) => m.role === 'manager') ? 'manager' : 'user';

  return (
    <>
      <HomeHero stats={stats} loggedIn={Boolean(user)} locale={locale} />
      <FeaturedCourses courses={featured} locale={locale} states={states} />
      <HowItWorks />
      <TeamsBlock viewer={viewer} locale={locale} />
      <FinalCta />
    </>
  );
}
