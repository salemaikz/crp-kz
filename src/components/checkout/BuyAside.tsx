// Правая колонка страницы покупки: «Ваш заказ» (тёмная карточка) и шаги покупки.
import { BookOpen, CalendarCheck, Clock, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { t as tl } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDuration } from '@/lib/format';
import type { BuyableCourse } from '@/lib/orders/types';
import { Card, Eyebrow, Price } from '@/components/ui';
import { HelpLine } from './parts';

/** Сводка заказа: курс, состав, срок доступа и цена (из предложения курса). */
export function OrderSummaryCard({ course, locale }: { course: BuyableCourse; locale: Locale }) {
  const t = useTranslations('checkout');
  const summary = tl(course.summary, locale);
  return (
    <section className="co-summary" aria-labelledby="co-summary-title">
      <Eyebrow>{t('buy.summary.eyebrow')}</Eyebrow>
      <h2 id="co-summary-title" className="co-summary__title">
        {tl(course.title, locale)}
      </h2>
      {summary && <p className="co-summary__text">{summary}</p>}
      <ul className="co-facts">
        {course.modulesCount > 1 && (
          <li>
            <Layers aria-hidden="true" />
            {t('common.modules', { count: course.modulesCount })}
          </li>
        )}
        {course.lessonsCount > 0 && (
          <li>
            <BookOpen aria-hidden="true" />
            {t('common.lessons', { count: course.lessonsCount })}
          </li>
        )}
        {course.durationMin > 0 && (
          <li>
            <Clock aria-hidden="true" />
            {formatDuration(course.durationMin, locale)}
          </li>
        )}
        <li>
          <CalendarCheck aria-hidden="true" />
          {course.accessDays ? t('common.accessDays', { days: course.accessDays }) : t('common.accessForever')}
        </li>
      </ul>
      <div className="co-summary__total">
        <span className="co-summary__total-label">{t('buy.summary.total')}</span>
        <Price kzt={course.priceKzt} size="lg" />
      </div>
      <p className="co-summary__fixed">{t('buy.summary.fixed')}</p>
    </section>
  );
}

/** Как проходит покупка + телефон для вопросов. */
export function BuyStepsCard() {
  const t = useTranslations('checkout.buy.steps');
  return (
    <Card className="co-steps-card" large>
      <h2 className="co-steps-card__title">{t('title')}</h2>
      <ol className="co-steps">
        <li>
          <span>{t('one')}</span>
        </li>
        <li>
          <span>{t('two')}</span>
        </li>
        <li>
          <span>{t('three')}</span>
        </li>
      </ol>
      <HelpLine />
    </Card>
  );
}
