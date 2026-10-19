import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogFilters } from '@/components/catalog/CatalogFilters';
import { CourseCard } from '@/components/catalog/CourseCard';
import { Button, Container, EmptyState, PageHeader, Section } from '@/components/ui';
import { getCurrentUser } from '@/lib/auth';
import { getMemberOrgIds, getViewerStates, listCatalogCourses } from '@/lib/catalog/queries';
import { localeAlternates } from '@/lib/catalog/seo';
import type { CatalogFilter } from '@/lib/catalog/types';
import { CATALOG_FILTERS, matchesFilter, parseFilter } from '@/lib/catalog/visibility';
import type { Locale } from '@/lib/content/types';
import { routing } from '@/lib/i18n/routing';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolveLocale(params: Props['params']): Promise<Locale> {
  const { locale: raw } = await params;
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'catalog.meta' });
  return {
    title: t('coursesTitle'),
    description: t('coursesDescription'),
    alternates: localeAlternates(locale, '/courses'),
  };
}

/** Каталог: опубликованные public-курсы и internal-курсы организаций зрителя, фильтры-чипы. */
export default async function CoursesPage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  setRequestLocale(locale);
  const t = await getTranslations('catalog.list');

  const user = await getCurrentUser();
  const memberOrgIds = await getMemberOrgIds(user?.id);
  const courses = await listCatalogCourses(memberOrgIds);
  const states = user ? await getViewerStates(user.id, courses) : undefined;

  const counts = Object.fromEntries(
    CATALOG_FILTERS.map((f) => [f, courses.filter((c) => matchesFilter(c, f)).length]),
  ) as Record<CatalogFilter, number>;
  // «Для сотрудников» показываем только тем, у кого такие курсы есть
  const available = CATALOG_FILTERS.filter((f) => f !== 'staff' || counts.staff > 0);
  const requested = parseFilter((await searchParams).f);
  const active = available.includes(requested) ? requested : 'all';
  const shown = courses.filter((c) => matchesFilter(c, active));

  return (
    <>
      <PageHeader tone="board" title={t('title')} lead={t('lead')} />
      <Section tone="board" spacing="tight">
        <Container>
          {courses.length === 0 ? (
            <EmptyState title={t('emptyAll.title')} description={t('emptyAll.text')} />
          ) : (
            <>
              <div className="cat-toolbar">
                <CatalogFilters active={active} available={available} counts={counts} />
                <p className="cat-toolbar__count" aria-live="polite">
                  {t('resultCount', { count: shown.length })}
                </p>
              </div>
              {shown.length > 0 ? (
                <div className="cat-grid">
                  {shown.map((course, index) => (
                    <CourseCard key={course.id} course={course} index={index} locale={locale} state={states?.get(course.id)} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t('empty.title')}
                  description={t('empty.text')}
                  action={
                    <Button href="/courses" variant="primary">
                      {t('empty.reset')}
                    </Button>
                  }
                />
              )}
              {active === 'staff' && <p className="cat-footnote">{t('staffNote')}</p>}
            </>
          )}
        </Container>
      </Section>
    </>
  );
}
