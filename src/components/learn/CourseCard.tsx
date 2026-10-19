import { Award, BookOpenCheck, PlayCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge, Button, Card, ProgressBar, TextLink } from '@/components/ui';
import { t as loc } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { Link } from '@/lib/i18n/navigation';
import { formatDate, formatDuration } from '@/lib/format';
import type { LearnerCourse } from '@/lib/learn/data';
import { coursePath, lessonPath } from '@/lib/learn/server';
import { CourseCover } from './CourseCover';
import { DueBadge } from './DueBadge';
import './learn.css';

type Props = { item: LearnerCourse; index: number; locale: Locale };

/** Карточка курса в «Моём обучении»: прогресс, срок, ближайший урок и одно главное действие. */
export async function CourseCard({ item, index, locale }: Props) {
  const t = await getTranslations('learn.card');
  const { course, enrollment, access, progress, certificateNumber } = item;
  const title = loc(course.title, locale);
  const closed = !access.ok;
  const finished = !closed && progress.complete;
  const started = progress.done > 0;
  const next = progress.next;
  const certificateHref = `${coursePath(course.slug)}/certificate`;

  const badges = (
    <>
      {closed &&
        (access.reason === 'expired' && enrollment.expiresAt ? (
          <Badge tone="warning">{t('expired', { date: formatDate(enrollment.expiresAt, locale, { short: true }) })}</Badge>
        ) : (
          <Badge tone="neutral">{t('revoked')}</Badge>
        ))}
      {finished && (
        <Badge tone="success" dot>
          {t('done')}
        </Badge>
      )}
      {!closed && !finished && enrollment.dueAt !== null && <DueBadge dueAt={enrollment.dueAt} locale={locale} />}
      {!closed && enrollment.source === 'assignment' && <Badge tone="info">{t('assigned')}</Badge>}
    </>
  );

  return (
    <Card as="article" large interactive padding="none" className="lrn-course" data-state={closed ? 'closed' : finished ? 'done' : 'active'}>
      <CourseCover cover={course.cover} index={index} badges={badges} />
      <div className="lrn-course__body">
        <h3 className="display lrn-course__title">
          <Link href={coursePath(course.slug)}>{title}</Link>
        </h3>

        {progress.total > 0 ? (
          <ProgressBar
            value={progress.pct}
            label={t('lessonsProgress', { done: progress.done, total: progress.total })}
            size="sm"
          />
        ) : (
          <p className="meta">{t('noLessons')}</p>
        )}

        <p className="meta">
          {t('lessonsCount', { count: progress.total })}
          {course.durationMin > 0 && ` · ${formatDuration(course.durationMin, locale)}`}
        </p>

        {!closed && !finished && next && started && (
          <p className="lrn-course__next">
            <PlayCircle aria-hidden="true" />
            <span>{t('next', { title: loc(next.title, locale) })}</span>
          </p>
        )}

        <div className="lrn-course__actions">
          {closed ? (
            <Button href={`/courses/${encodeURIComponent(course.slug)}`} variant="ghost" size="sm">
              {access.reason === 'expired' ? t('renew') : t('aboutCourse')}
            </Button>
          ) : finished ? (
            <>
              <Button href={certificateNumber ? certificateHref : coursePath(course.slug)} size="sm">
                <Award aria-hidden="true" />
                {certificateNumber ? t('certificate') : t('getCertificate')}
              </Button>
              <TextLink href={coursePath(course.slug)}>{t('program')}</TextLink>
            </>
          ) : next ? (
            <>
              <Button href={lessonPath(course.slug, next.slug)} size="sm">
                {started ? t('continue') : t('start')}
              </Button>
              <TextLink href={coursePath(course.slug)}>{t('program')}</TextLink>
            </>
          ) : (
            <Button href={coursePath(course.slug)} variant="ghost" size="sm">
              <BookOpenCheck aria-hidden="true" />
              {t('open')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
