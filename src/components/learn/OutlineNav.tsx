import { getTranslations } from 'next-intl/server';
import { Card, ProgressBar } from '@/components/ui';
import { t as loc } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { Link } from '@/lib/i18n/navigation';
import { coursePath, lessonPath } from '@/lib/learn/server';
import type { CourseProgress } from '@/lib/learn/types';
import { StatusIcon } from './Status';
import './learn.css';

type Props = {
  locale: Locale;
  courseSlug: string;
  courseTitle: string;
  progress: CourseProgress;
  currentLessonId?: string;
};

/**
 * Компактное оглавление курса для страницы урока: боковая колонка (десктоп) и раскрывашка (телефон).
 * Закрытые уроки — не ссылки. Рендерится дважды (две раскладки), поэтому без id.
 */
export async function OutlineNav({ locale, courseSlug, courseTitle, progress, currentLessonId }: Props) {
  const t = await getTranslations('learn');
  return (
    <Card as="div" large padding="none" className="lrn-outline">
      <div className="lrn-outline__head">
        <p className="lrn-outline__course display">
          <Link href={coursePath(courseSlug)}>{courseTitle}</Link>
        </p>
        <ProgressBar value={progress.pct} label={t('outline.progress', { done: progress.done, total: progress.total })} size="sm" />
      </div>
      <nav aria-label={t('outline.aria')} className="lrn-outline__modules">
        {progress.modules.map((m, mi) => (
          <div key={m.id} className="lrn-outline__module">
            <p className="lrn-outline__module-title">
              {t('outline.module', { n: mi + 1 })} · {loc(m.title, locale)}
            </p>
            <ul className="lrn-outline__list">
              {m.lessons.map((l) => {
                const title = loc(l.title, locale);
                const current = l.id === currentLessonId;
                const status = l.state === 'done' ? t('state.done') : l.state === 'locked' ? t('state.locked') : null;
                const body = (
                  <>
                    <StatusIcon state={l.state} current={l.id === progress.next?.id} />
                    <span>
                      {title}
                      {status && <span className="visually-hidden"> — {status}</span>}
                    </span>
                  </>
                );
                return (
                  <li key={l.id}>
                    {l.state === 'locked' ? (
                      <span className="lrn-outline__item" aria-disabled="true">
                        {body}
                      </span>
                    ) : (
                      <Link
                        href={lessonPath(courseSlug, l.slug)}
                        className="lrn-outline__item"
                        aria-current={current ? 'page' : undefined}
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </Card>
  );
}
