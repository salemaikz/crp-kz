import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookOpenText } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CompletionCard } from '@/components/learn/CompletionCard';
import { CourseOutline } from '@/components/learn/CourseOutline';
import { DueBadge } from '@/components/learn/DueBadge';
import { NoAccess } from '@/components/learn/Notices';
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  Container,
  EmptyState,
  PageHeader,
  ProgressBar,
  Section,
} from '@/components/ui';
import { getCurrentUser, requireUser } from '@/lib/auth';
import { t as loc } from '@/lib/content/l10n';
import { formatDate, formatDuration } from '@/lib/format';
import { routing } from '@/lib/i18n/routing';
import { getCertificate } from '@/lib/learn/certificates';
import { getQuizLessonIds } from '@/lib/learn/data';
import { coursePath, getCourseAccess, lessonPath, routeParam } from '@/lib/learn/server';
import '@/components/learn/learn.css';

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'learn.meta' });
  // название курса в <title> — только если есть доступ (иначе общий заголовок)
  const user = await getCurrentUser();
  const access = user ? await getCourseAccess(user.id, routeParam(slug)) : null;
  const title = access?.status === 'ok' ? loc(access.course.title, locale) : t('courseTitle');
  return { title, robots: { index: false } };
}

export default async function CoursePage({ params }: Props) {
  const { locale: raw, slug: rawSlug } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const slug = routeParam(rawSlug);

  const user = await requireUser(locale, `/${locale}/learn/${rawSlug}`);
  const access = await getCourseAccess(user.id, slug);
  if (access.status === 'not_found') notFound();
  if (access.status === 'denied') {
    return <NoAccess course={access.course} reason={access.reason} expiresAt={access.enrollment?.expiresAt ?? null} locale={locale} />;
  }

  const { course, enrollment, progress } = access;
  const [t, a11y, quizLessonIds, certificate] = await Promise.all([
    getTranslations('learn.course'),
    getTranslations('common.a11y'),
    getQuizLessonIds(course.id, locale),
    progress.complete ? getCertificate(user.id, course.id) : Promise.resolve(null),
  ]);
  const nav = await getTranslations('common.nav');

  const title = loc(course.title, locale);
  const started = progress.done > 0;
  const certificateHref = `${coursePath(course.slug)}/certificate`;
  const next = progress.next;

  // у пройденного курса главная кнопка — в карточке завершения ниже («одна красная кнопка на экран»)
  const cta = progress.complete ? null : next ? (
    <Button href={lessonPath(course.slug, next.slug)} size="lg" block data-testid="continue-course">
      {started ? t('continue') : t('start')}
    </Button>
  ) : null;

  const aside = (
    <Card large padding="none" className="lrn-progress-card" data-complete={progress.complete}>
      <div className="lrn-progress-card__top">
        <p className="meta">{t('progressTitle')}</p>
        <span className="lrn-progress-card__pct" data-testid="course-pct">
          {progress.pct}%
        </span>
      </div>
      <ProgressBar value={progress.pct} label={t('progressLabel')} hideLabel showValue={false} />
      <p className="meta">{t('lessonsDone', { done: progress.done, total: progress.total })}</p>
      {cta}
      {!progress.complete && next && started && (
        <p className="meta">{t('nextUp', { title: loc(next.title, locale) })}</p>
      )}
      <ul className="lrn-progress-card__facts">
        {enrollment.dueAt !== null && !progress.complete && (
          <li>
            <DueBadge dueAt={enrollment.dueAt} locale={locale} />
          </li>
        )}
        {course.durationMin > 0 && <li>{t('duration', { value: formatDuration(course.durationMin, locale) })}</li>}
        <li>{enrollment.expiresAt ? t('accessUntil', { date: formatDate(enrollment.expiresAt, locale) }) : t('accessForever')}</li>
      </ul>
    </Card>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs label={a11y('breadcrumbs')} items={[{ label: nav('learn'), href: '/learn' }, { label: title }]} />
        }
        title={title}
        lead={loc(course.summary, locale) || undefined}
        aside={aside}
      />

      <Section tone="board" spacing="tight">
        <Container>
          {progress.complete && (
            <div className="lrn-block">
              <CompletionCard
                courseId={course.id}
                courseTitle={title}
                lessonsCount={progress.total}
                locale={locale}
                certificateNumber={certificate?.number ?? null}
                courseHref={coursePath(course.slug)}
                certificateHref={certificateHref}
                showProgramLink={false}
              />
            </div>
          )}

          {course.sequential && !progress.complete && (
            <div className="lrn-block">
              <Alert tone="info">{t('sequentialNote')}</Alert>
            </div>
          )}

          <div className="lrn-block">
            {progress.total === 0 ? (
              <EmptyState icon={<BookOpenText />} title={t('empty.title')} description={t('empty.description')} />
            ) : (
              <CourseOutline locale={locale} courseSlug={course.slug} progress={progress} quizLessonIds={quizLessonIds} />
            )}
          </div>
        </Container>
      </Section>
    </>
  );
}
