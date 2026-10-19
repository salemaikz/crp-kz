import { Award, BookOpen, Check, ListChecks, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Card, Price, ProgressBar } from '@/components/ui';
import type { CourseCta } from '@/lib/catalog/cta';
import type { CourseDetail, ViewerCourseState } from '@/lib/catalog/types';
import { accessPeriod } from '@/lib/catalog/visibility';
import type { Locale } from '@/lib/content/types';
import { dueStatus, formatDate, relativeDue } from '@/lib/format';
import { CourseCtaButton } from './CourseCtaButton';
import './catalog.css';

type Props = {
  course: CourseDetail;
  locale: Locale;
  cta: CourseCta;
  state?: ViewerCourseState;
  /** Подпись организации для внутренних курсов («ЦРП»). */
  org: string;
};

/** Карточка цены в шапке курса: цена, срок доступа, состояние зрителя и главная кнопка. */
export function PriceCard({ course, locale, cta, state, org }: Props) {
  const t = useTranslations('catalog');
  const staff = course.visibility === 'internal';
  const paid = (course.priceKzt ?? 0) > 0;
  const period = accessPeriod(course.accessDays);
  const periodText = period ? t(period.unit === 'month' ? 'counts.months' : 'counts.days', { count: period.value }) : null;
  const enrolled = state?.access.ok === true;
  const completed = enrolled && state.lessonsTotal > 0 && state.lessonsDone >= state.lessonsTotal;
  const showDue = enrolled && !completed && state.dueAt !== null;
  const due = showDue ? dueStatus(state.dueAt as number) : null;

  return (
    <Card large padding="lg" className="on-paper cat-price">
      <div className="cat-price__head">
        <span className="cat-price__label">{t('course.price.label')}</span>
        {staff ? (
          <>
            <span className="cat-price__value">{t('course.price.staff')}</span>
            <span className="cat-price__note">{t('course.price.staffHint', { org })}</span>
          </>
        ) : (
          <>
            <Price kzt={course.priceKzt} size="lg" />
            {periodText ? (
              <span className="cat-price__note">{t('course.price.access', { period: periodText })}</span>
            ) : (
              <span className="cat-price__note">{t('course.price.accessUnlimited')}</span>
            )}
          </>
        )}
      </div>

      {enrolled && (
        <div className="cat-price__state">
          <p className="cat-price__state-title">{completed ? t('course.state.completed') : t('course.state.enrolled')}</p>
          <ProgressBar
            size="sm"
            value={state.percent}
            label={t('course.state.progressLabel')}
            ariaLabel={t('course.state.progressLabel')}
          />
          <p className="cat-price__note">
            {t('course.state.progressDone', { done: state.lessonsDone, total: state.lessonsTotal })}
          </p>
          {showDue && due && (
            <p className="cat-price__due">
              <span>
                {t('course.state.due')}: {formatDate(state.dueAt as number, locale)}
              </span>
              <Badge tone={due === 'overdue' ? 'red' : due === 'ok' ? 'neutral' : 'warning'}>
                {relativeDue(state.dueAt as number, locale)}
              </Badge>
            </p>
          )}
          {state.expiresAt !== null && (
            <p className="cat-price__note">{t('course.state.accessUntil', { date: formatDate(state.expiresAt, locale) })}</p>
          )}
        </div>
      )}

      {!enrolled && state?.access.reason === 'expired' && state.expiresAt !== null && (
        <Alert tone="warning">{t('course.state.expired', { date: formatDate(state.expiresAt, locale) })}</Alert>
      )}
      {!enrolled && state?.access.reason === 'revoked' && <Alert tone="warning">{t('course.state.revoked')}</Alert>}

      {cta.kind !== 'unavailable' && (
        <div className="cat-price__cta">
          <CourseCtaButton slug={course.slug} cta={cta} />
        </div>
      )}

      <ul className="cat-price__list">
        <li>
          <BookOpen aria-hidden="true" />
          {t('course.includes.lessons', { count: course.lessonsCount })}
        </li>
        <li>
          <ListChecks aria-hidden="true" />
          {t('course.includes.tests')}
        </li>
        <li>
          <Award aria-hidden="true" />
          {t('course.includes.certificate')}
        </li>
        <li>
          <Smartphone aria-hidden="true" />
          {t('course.includes.mobile')}
        </li>
      </ul>

      {paid && cta.kind === 'buy' && (
        <p className="cat-price__pay">
          <Check aria-hidden="true" />
          {t('course.price.payment')}
        </p>
      )}
    </Card>
  );
}
