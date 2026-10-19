import { getTranslations } from 'next-intl/server';
import { TextLink } from '@/components/ui';
import { IssueCertificateButton } from './IssueCertificateButton';
import './learn.css';

type Props = {
  courseId: string;
  courseTitle: string;
  lessonsCount: number;
  locale: 'ru' | 'kz';
  /** Номер выданного сертификата, если он уже есть. */
  certificateNumber: string | null;
  /** Путь программы курса и страницы сертификата (без локали). */
  courseHref: string;
  certificateHref: string;
  /** Показывать ссылку «К программе курса» (на самой программе она не нужна). */
  showProgramLink?: boolean;
};

/** Экран завершения курса: «Курс пройден», одна фраза и «Получить сертификат» (или «Открыть», если уже выдан). Плоская карточка без декора. */
export async function CompletionCard({
  courseId,
  courseTitle,
  lessonsCount,
  locale,
  certificateNumber,
  courseHref,
  certificateHref,
  showProgramLink = true,
}: Props) {
  const t = await getTranslations('learn.completion');
  return (
    <section className="lrn-complete card card--lg" aria-labelledby="completion-title" data-testid="course-complete">
      <h2 id="completion-title" className="display lrn-complete__title">
        {t('title')}
      </h2>
      <p className="lrn-complete__text">{t('text', { count: lessonsCount, course: courseTitle })}</p>
      <div className="lrn-complete__actions">
        <IssueCertificateButton
          courseId={courseId}
          locale={locale}
          certificateHref={certificateHref}
          issued={certificateNumber !== null}
        />
        {certificateNumber && <span className="meta">{t('number', { number: certificateNumber })}</span>}
      </div>
      <div className="lrn-complete__links">
        {showProgramLink && <TextLink href={courseHref}>{t('toCourse')}</TextLink>}
        <TextLink href="/learn">{t('toLearn')}</TextLink>
      </div>
    </section>
  );
}
