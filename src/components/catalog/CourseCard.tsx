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
  /** Порядковый номер курса в выдаче: по нему выбирается тон обложки. */
  index: number;
  locale: Locale;
  /** Состояние зрителя по курсу; нет — гость или нет зачисления. */
  state?: ViewerCourseState;
};

/**
 * Карточка курса в каталоге и на главной: сверху панель тона с числом уроков, ниже название,
 * строка «уровень» (для курсов сотрудников — ещё метка организации), краткое описание,
 * разделитель и цена или статус зрителя. Вся карточка — ссылка.
 */
export function CourseCard({ course, index, locale, state }: Props) {
  const t = useTranslations('catalog');
  const title = pick(course.title, locale);
  const enrolled = state?.access.ok === true;
  const expired = state?.access.reason === 'expired';
  const completed = enrolled && state.lessonsTotal > 0 && state.lessonsDone >= state.lessonsTotal;
  const staff = course.visibility === 'internal';
  const org = course.ownerOrgKind === 'owner' ? t('card.orgOwner') : (course.ownerOrgName ?? t('card.orgFallback'));
  // у публичного курса «платный/бесплатный» уже говорит цена внизу карточки
  const meta = [course.level ? t(`level.${course.level}`) : null, staff ? t('card.staffLabel', { org }) : null]
    .filter(Boolean)
    .join(' · ');
  const summary = pick(course.summary, locale);

  return (
    <Card as="article" padding="none" interactive className="cat-card">
      <CourseCover index={index} cover={course.cover}>
        <strong className="cat-cover__value">{t('counts.lessons', { count: course.lessonsCount })}</strong>
        {course.durationMin > 0 && <span className="cat-cover__sub">{formatDuration(course.durationMin, locale)}</span>}
      </CourseCover>

      <div className="cat-card__body">
        <h3 className="cat-card__title">
          <Link href={`/courses/${course.slug}`} className="cat-card__link">
            {title}
          </Link>
        </h3>
        {meta && <p className="cat-card__meta">{meta}</p>}
        {summary && <p className="cat-card__summary">{summary}</p>}

        <div className="cat-card__foot">
          {completed ? (
            <Badge tone="success" dot>
              {t('card.completed')}
            </Badge>
          ) : enrolled ? (
            <ProgressBar
              size="sm"
              value={state.percent}
              label={t('card.progressLabel')}
              ariaLabel={`${t('card.progressLabel')}: ${title}`}
            />
          ) : expired ? (
            <Badge tone="warning">{t('card.expired')}</Badge>
          ) : staff ? (
            <span className="cat-card__staff">{t('card.staffPrice')}</span>
          ) : (
            <Price kzt={course.priceKzt} />
          )}
        </div>
      </div>
    </Card>
  );
}
