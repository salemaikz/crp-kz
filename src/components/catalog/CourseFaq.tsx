import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CRP_CONTACTS } from '@/lib/brand';
import './catalog.css';

type Props = {
  /** Как открывается курс: определяет ответ на «Как начать учиться?». */
  audience: 'free' | 'paid' | 'staff';
  /** Подпись срока доступа («12 месяцев») или null — бессрочно. */
  period: string | null;
};

/** Частые вопросы: нативные <details>, вопрос про оплату — только для платных курсов. */
export function CourseFaq({ audience, period }: Props) {
  const t = useTranslations('catalog.course.faq');
  const items: Array<{ key: string; q: string; a: string }> = [
    { key: 'start', q: t('start.q'), a: t(`start.${audience}`) },
    {
      key: 'access',
      q: t('access.q'),
      a: period ? t('access.limited', { period }) : t('access.unlimited'),
    },
    { key: 'certificate', q: t('certificate.q'), a: t('certificate.a') },
    { key: 'mobile', q: t('mobile.q'), a: t('mobile.a') },
    ...(audience === 'paid' ? [{ key: 'payment', q: t('payment.q'), a: t('payment.a') }] : []),
    { key: 'help', q: t('help.q'), a: t('help.a', { phone: CRP_CONTACTS.phone }) },
  ];
  return (
    <div className="cat-faq">
      {items.map((item) => (
        <details key={item.key} className="cat-faq__item">
          <summary>
            <span>{item.q}</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
