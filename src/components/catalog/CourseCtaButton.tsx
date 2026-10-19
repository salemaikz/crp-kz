import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';
import { CRP_CONTACTS } from '@/lib/brand';
import type { CourseCta } from '@/lib/catalog/cta';
import { StartCourseForm } from './StartCourseForm';
import './catalog.css';

type Props = { slug: string; cta: CourseCta; size?: 'md' | 'lg' };

/** Главная кнопка курса по состоянию зрителя: Продолжить / Начать / Купить (или пояснение, если нельзя). */
export function CourseCtaButton({ slug, cta, size = 'lg' }: Props) {
  const t = useTranslations('catalog.course');
  switch (cta.kind) {
    case 'continue':
      return (
        <Button href={`/learn/${slug}`} variant="primary" size={size} block>
          {t('cta.continue')}
        </Button>
      );
    case 'start':
      return (
        <StartCourseForm
          slug={slug}
          size={size}
          label={cta.audience === 'staff' ? t('cta.startStaff') : t('cta.startFree')}
          hint={cta.needsLogin ? t('cta.needLogin') : undefined}
        />
      );
    case 'buy':
      return (
        <Button href={`/courses/${slug}/buy`} variant="primary" size={size} block>
          {cta.renew ? t('cta.renew') : t('cta.buy')}
        </Button>
      );
    case 'paused':
      return <Alert tone="warning">{t('price.paused', { phone: CRP_CONTACTS.phone })}</Alert>;
    case 'unavailable':
      return null;
  }
}
