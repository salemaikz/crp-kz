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

/** Частые вопросы: нативные <details>. Срок доступа — только у курсов с ограничением, остальное страница уже говорит. */
export function CourseFaq({ audience, period }: Props) {
  const t = useTranslations('catalog.course.faq');
  const items: Array<{ key: string; q: string; a: string }> = [
    { key: 'start', q: t('start.q'), a: t(`start.${audience}`) },
    ...(period ? [{ key: 'access', q: t('access.q'), a: t('access.limited', { period }) }] : []),
    { key: 'certificate', q: t('certificate.q'), a: t('certificate.a') },
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
