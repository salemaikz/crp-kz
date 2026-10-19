import { ArrowRight, BookOpen, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Card, Price, ProgressBar } from '@/components/ui';
import type { Locale } from '@/lib/content/types';
import { t as pick } from '@/lib/content/l10n';
import { formatDuration } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import type { CatalogCourse, ViewerCourseState } from '@/lib/catalog/types';
import { CourseCover } from './CourseCover';
import './catalog.css';

type Props = {
  course: CatalogCourse;
  locale: Locale;
  /** Состояние зрителя по курсу; нет — гость или нет зачисления. */
  state?: ViewerCourseState;
};

/** Карточка курса в каталоге и на лендинге: обложка, мета, цена или прогресс. Вся карточка — ссылка. */
export function CourseCard({ course, locale, state }: Props) {
  const t = useTranslations('catalog');
  const title = pick(course.title, locale);
  const summary = pick(course.summary, locale);
  const enrolled = state?.access.ok === true;
  const expired = state?.access.reason === 'expired';
  const completed = enrolled && state.lessonsTotal > 0 && state.lessonsDone >= state.lessonsTotal;
  const staff = course.visibility === 'internal';
  const org = course.ownerOrgKind === 'owner' ? 'ЦРП' : (course.ownerOrgName ?? t('card.orgFallback'));

  return (
    <Card as="article" padding="none" large interactive className="cat-card">
      <CourseCover slug={course.slug} title={title} cover={course.cover}>
        {course.level && <Badge tone="night">{t(`level.${course.level}`)}</Badge>}
        {completed ? (
          <Badge tone="success" dot>
            {t('card.completed')}
          </Badge>
        ) : enrolled ? (
          <Badge tone="red" dot>
            {t('card.enrolled')}
          </Badge>
        ) : expired ? (
          <Badge tone="warning">{t('card.expired')}</Badge>
        ) : staff ? (
          <Badge tone="red">{t('card.staffLabel', { org })}</Badge>
        ) : null}
      </CourseCover>

      <div className="cat-card__body">
        <ul className="cat-card__meta">
          {course.durationMin > 0 && (
            <li>
              <Clock aria-hidden="true" />
              {formatDuration(course.durationMin, locale)}
            </li>
          )}
          <li>
            <BookOpen aria-hidden="true" />
            {t('counts.lessons', { count: course.lessonsCount })}
          </li>
        </ul>

        <h3 className="cat-card__title">
          <Link href={`/courses/${course.slug}`} className="cat-card__link">
            {title}
          </Link>
        </h3>
        {summary && <p className="cat-card__summary">{summary}</p>}

        <div className="cat-card__foot">
          {enrolled ? (
            <ProgressBar
              size="sm"
              value={state.percent}
              label={t('card.progressLabel')}
              ariaLabel={`${t('card.progressLabel')}: ${title}`}
            />
          ) : (
            <div className="cat-card__price">
              {staff ? <span className="cat-card__staff">{t('card.staffPrice')}</span> : <Price kzt={course.priceKzt} />}
              <span className="cat-card__more" aria-hidden="true">
                {t('card.details')}
                <ArrowRight />
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
