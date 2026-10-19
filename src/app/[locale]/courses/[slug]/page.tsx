import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Languages } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CertificatePreview } from '@/components/catalog/CertificatePreview';
import { CourseFaq } from '@/components/catalog/CourseFaq';
import { CourseMarkdown } from '@/components/catalog/CourseMarkdown';
import { PriceCard } from '@/components/catalog/PriceCard';
import { ProgramAccordion } from '@/components/catalog/ProgramAccordion';
import { Breadcrumbs, Container, PageHeader, Section } from '@/components/ui';
import '@/components/catalog/catalog.css';
import { getCurrentUser } from '@/lib/auth';
import { CRP_CONTACTS } from '@/lib/brand';
import { resolveCourseCta } from '@/lib/catalog/cta';
import { getCourseDetail, getCourseProgram, getMemberOrgIds, getViewerStates } from '@/lib/catalog/queries';
import { localeAlternates, metaDescription } from '@/lib/catalog/seo';
import { accessPeriod } from '@/lib/catalog/visibility';
import { hasLocale as hasL10n, htmlLang, t as pick } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDuration } from '@/lib/format';
import { routing } from '@/lib/i18n/routing';

type Props = { params: Promise<{ locale: string; slug: string }> };

/** Зритель и курс одним запросом на рендер: generateMetadata и страница не дублируют обращения к БД. */
const loadCourse = cache(async (slug: string) => {
  const user = await getCurrentUser();
  const memberOrgIds = await getMemberOrgIds(user?.id);
  const course = await getCourseDetail(slug, memberOrgIds);
  return { user, memberOrgIds, course };
});

async function resolveLocale(params: Props['params']): Promise<{ locale: Locale; slug: string }> {
  const { locale: raw, slug } = await params;
  return { locale: hasLocale(routing.locales, raw) ? raw : routing.defaultLocale, slug };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await resolveLocale(params);
  const { course } = await loadCourse(slug);
  // курса нет, это черновик, private или чужой internal — страница отдаст 404
  if (!course) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'catalog.meta' });
  const title = pick(course.title, locale);
  const description = metaDescription(pick(course.summary, locale) || t('courseFallback'));
  const isPublic = course.visibility === 'public';
  return {
    title,
    description,
    alternates: localeAlternates(locale, `/courses/${course.slug}`),
    // внутренние курсы не индексируем
    robots: isPublic ? undefined : { index: false, follow: false },
    openGraph: { title, description, type: 'website' },
  };
}

/** Страница курса: шапка с фактами и карточкой цены, программа, описание (там же — для кого), FAQ, пример сертификата. */
export default async function CoursePage({ params }: Props) {
  const { locale, slug } = await resolveLocale(params);
  setRequestLocale(locale);
  const { user, memberOrgIds, course } = await loadCourse(slug);
  if (!course) notFound();

  const [t, tCommon] = await Promise.all([getTranslations('catalog'), getTranslations('common')]);
  const [program, states] = await Promise.all([
    getCourseProgram(course.id),
    user ? getViewerStates(user.id, [course]) : Promise.resolve(undefined),
  ]);
  const state = states?.get(course.id);

  const staff = course.visibility === 'internal';
  const paid = (course.priceKzt ?? 0) > 0;
  const isMember = course.ownerOrgId !== null && memberOrgIds.includes(course.ownerOrgId);
  const org = course.ownerOrgKind === 'owner' ? t('card.orgOwner') : (course.ownerOrgName ?? t('card.orgFallback'));
  const cta = resolveCourseCta({
    visibility: course.visibility,
    priceKzt: course.priceKzt,
    offerActive: course.offerActive,
    isMember,
    loggedIn: Boolean(user),
    access: user ? (state?.access ?? { ok: false, reason: 'none' }) : null,
  });

  const title = pick(course.title, locale);
  const summary = pick(course.summary, locale);
  const description = pick(course.description, locale);
  const period = accessPeriod(course.accessDays);
  const periodText = period
    ? t(period.unit === 'month' ? 'counts.months' : 'counts.days', { count: period.value })
    : null;

  const jsonLd =
    course.visibility === 'public'
      ? {
          '@context': 'https://schema.org',
          '@type': 'Course',
          name: title,
          description: summary || undefined,
          inLanguage: htmlLang(locale),
          provider: { '@type': 'Organization', name: tCommon('brand.full'), sameAs: CRP_CONTACTS.site },
          ...(paid
            ? { offers: { '@type': 'Offer', price: course.priceKzt, priceCurrency: 'KZT', category: 'Paid' } }
            : { isAccessibleForFree: true }),
        }
      : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // < экранируем, чтобы название курса не могло закрыть тег script
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      <PageHeader
        className="cat-course-header"
        tone="night"
        breadcrumbs={
          <Breadcrumbs
            label={tCommon('a11y.breadcrumbs')}
            items={[{ label: t('course.breadcrumbRoot'), href: '/courses' }, { label: title }]}
          />
        }
        title={title}
        lead={summary || undefined}
        meta={
          <ul className="cat-facts">
            <li>
              {t('course.meta.level')}: <strong>{course.level ? t(`level.${course.level}`) : t('level.any')}</strong>
            </li>
            {course.durationMin > 0 && (
              <li>
                {t('course.meta.duration')}: <strong>{formatDuration(course.durationMin, locale)}</strong>
              </li>
            )}
            <li>
              <strong>{t('counts.modules', { count: course.modulesCount })}</strong>
              {' · '}
              <strong>{t('counts.lessons', { count: course.lessonsCount })}</strong>
            </li>
          </ul>
        }
        aside={<PriceCard course={course} locale={locale} cta={cta} state={state} org={org} />}
      />

      <Section tone="board" spacing="tight">
        <Container className="cat-course">
          <div className="cat-course__main">
            <section className="cat-block" aria-labelledby="program-title">
              <h2 id="program-title" className="display cat-block__title">
                {t('course.sections.program')}
              </h2>
              <ProgramAccordion modules={program} locale={locale} />
            </section>

            {description && (
              <section className="cat-block" aria-labelledby="about-title">
                <h2 id="about-title" className="display cat-block__title">
                  {t('course.sections.about')}
                </h2>
                {locale !== 'ru' && !hasL10n(course.description, locale) && (
                  <p className="cat-note">
                    <Languages size={16} aria-hidden="true" />
                    {t('course.ruNote')}
                  </p>
                )}
                <CourseMarkdown source={description} />
              </section>
            )}

            <section className="cat-block" aria-labelledby="faq-title">
              <h2 id="faq-title" className="display cat-block__title">
                {t('course.sections.faq')}
              </h2>
              <CourseFaq audience={staff ? 'staff' : paid ? 'paid' : 'free'} period={periodText} />
            </section>
          </div>

          <aside className="cat-course__side" aria-label={t('course.sections.certificate')}>
            <CertificatePreview courseTitle={title} />
          </aside>
        </Container>
      </Section>
    </>
  );
}
