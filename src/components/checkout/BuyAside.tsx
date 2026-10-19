// Правая колонка страницы покупки: сводка заказа. Плоская карточка, без иконок.
import { useTranslations } from 'next-intl';
import { t as tl } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDuration } from '@/lib/format';
import type { BuyableCourse } from '@/lib/orders/types';
import { Card, Price } from '@/components/ui';
import { HelpLine } from './parts';

/** Сводка заказа: состав и срок доступа одной строкой, цена и телефон помощи. Название курса — в заголовке страницы. */
export function OrderSummaryCard({ course, locale }: { course: BuyableCourse; locale: Locale }) {
  const t = useTranslations('checkout');
  const summary = tl(course.summary, locale);
  const facts = [
    course.modulesCount > 1 ? t('common.modules', { count: course.modulesCount }) : null,
    course.lessonsCount > 0 ? t('common.lessons', { count: course.lessonsCount }) : null,
    course.durationMin > 0 ? formatDuration(course.durationMin, locale) : null,
    course.accessDays ? t('common.accessDays', { days: course.accessDays }) : t('common.accessForever'),
  ].filter((f): f is string => Boolean(f));
  return (
    <Card large padding="lg" className="co-summary">
      {summary && <p className="co-summary__text">{summary}</p>}
      <p className="co-facts">{facts.join(' · ')}</p>
      <div className="co-summary__total">
        <span className="co-summary__total-label">{t('buy.summary.total')}</span>
        <Price kzt={course.priceKzt} size="lg" />
      </div>
      <p className="co-summary__fixed">{t('buy.summary.fixed')}</p>
      <HelpLine />
    </Card>
  );
}
