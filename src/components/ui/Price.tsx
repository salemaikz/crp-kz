import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/lib/content/types';
import { formatPrice } from '@/lib/format';
import { cn } from './cn';

type Props = {
  /** Цена в целых тенге; 0 или null — «Бесплатно». */
  kzt: number | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  /** Показать «от 49 000 ₸». */
  from?: boolean;
  className?: string;
};

/** Цена в тенге: «99 000 ₸» (узкие пробелы между разрядами) или «Бесплатно». */
export function Price({ kzt, size = 'md', from, className }: Props) {
  const t = useTranslations('common.price');
  const locale = useLocale() as Locale;
  if (!kzt) {
    return <span className={cn('price', `price--${size}`, 'price--free', className)}>{t('free')}</span>;
  }
  const value = formatPrice(kzt, locale);
  return <span className={cn('price', `price--${size}`, className)}>{from ? t('from', { price: value }) : value}</span>;
}
