import { getTranslations } from 'next-intl/server';
import { Badge, Button, Card, ProgressBar } from '@/components/ui';
import { t as loc } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { Link } from '@/lib/i18n/navigation';
import { formatDate, formatDuration } from '@/lib/format';
import type { LearnerCourse } from '@/lib/learn/data';
import { coursePath, lessonPath } from '@/lib/learn/server';
import { DueBadge } from './DueBadge';
import './learn.css';

type Props = { item: LearnerCourse; locale: Locale };

/**
 * Карточка курса в «Моём обучении»: плоская, без обложки. Название (вся карточка — ссылка),
 * статус, прогресс, срок и одно действие.
 */
export async function CourseCard({ item, locale }: Props) {
  const t = await getTranslations('learn.card');
  const { course, enrollment, access, progress, certificateNumber } = item;
  const title = loc(course.title, locale);
  const closed = !access.ok;
  const finished = !closed && progress.complete;
  const started = progress.done > 0;
  const next = progress.next;
  const dueAt = !closed && !finished ? enrollment.dueAt : null;
  const assigned = !closed && enrollment.source === 'assignment';
  const hasBadges = closed || finished || dueAt !== null || assigned;

  return (
    <Card as="article" large interactive padding="md" className="lrn-course" data-state={closed ? 'closed' : finished ? 'done' : 'active'}>
      {hasBadges && (
        <div className="lrn-course__badges">
          {closed &&
            (access.reason === 'expired' && enrollment.expiresAt ? (
              <Badge tone="warning">{t('expired', { date: formatDate(enrollment.expiresAt, locale) })}</Badge>
            ) : (
              <Badge tone="neutral">{t('revoked')}</Badge>
            ))}
          {finished && (
            <Badge tone="success" dot>
              {t('done')}
            </Badge>
          )}
          {dueAt !== null && <DueBadge dueAt={dueAt} locale={locale} />}
          {assigned && <Badge tone="info">{t('assigned')}</Badge>}
        </div>
      )}

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

      {!closed && !finished && started && next && <p className="meta">{t('nextUp', { title: loc(next.title, locale) })}</p>}

      {course.durationMin > 0 && <p className="meta">{t('duration', { value: formatDuration(course.durationMin, locale) })}</p>}

      <div className="lrn-course__actions">
        {closed ? (
          <Button href={`/courses/${encodeURIComponent(course.slug)}`} variant="ghost" size="sm">
            {access.reason === 'expired' ? t('renew') : t('aboutCourse')}
          </Button>
        ) : finished ? (
          <Button href={certificateNumber ? `${coursePath(course.slug)}/certificate` : coursePath(course.slug)} size="sm">
            {certificateNumber ? t('certificate') : t('getCertificate')}
          </Button>
        ) : next ? (
          <Button href={lessonPath(course.slug, next.slug)} size="sm">
            {started ? t('continue') : t('start')}
          </Button>
        ) : (
          <Button href={coursePath(course.slug)} variant="ghost" size="sm">
            {t('open')}
          </Button>
        )}
      </div>
    </Card>
  );
}
