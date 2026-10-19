import { ArrowRight, Clock, Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge, Card } from '@/components/ui';
import { t as loc } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDuration } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { lessonPath } from '@/lib/learn/server';
import type { CourseProgress } from '@/lib/learn/types';
import { StatusIcon } from './Status';
import './learn.css';

type Props = {
  locale: Locale;
  courseSlug: string;
  progress: CourseProgress;
  /** Id уроков, в которых есть тест. */
  quizLessonIds: ReadonlySet<string>;
};

/** Программа курса: модули и уроки с галочками, замками и пометкой «Тест». */
export async function CourseOutline({ locale, courseSlug, progress, quizLessonIds }: Props) {
  const t = await getTranslations('learn');
  const started = progress.done > 0;
  return (
    <div className="lrn-modules">
      {progress.modules.map((m, mi) => (
        <Card as="section" large padding="none" className="lrn-module" key={m.id} aria-labelledby={`module-${m.id}`}>
          <header className="lrn-module__head">
            <p className="meta">{t('outline.module', { n: mi + 1 })}</p>
            <h2 id={`module-${m.id}`} className="display lrn-module__title">
              {loc(m.title, locale)}
            </h2>
            <p className="meta lrn-module__meta">
              {t('outline.moduleProgress', { done: m.done, total: m.lessons.length })}
            </p>
          </header>
          <ol className="lrn-lessons">
            {m.lessons.map((l) => {
              const current = l.id === progress.next?.id;
              const locked = l.state === 'locked';
              const status = l.state === 'done' ? t('state.done') : locked ? t('state.locked') : null;
              const body = (
                <>
                  <StatusIcon state={l.state} current={current} />
                  <span>
                    <span className="lrn-lesson__title">
                      {loc(l.title, locale)}
                      {status && <span className="visually-hidden"> — {status}</span>}
                    </span>
                    <span className="lrn-lesson__sub">
                      {l.durationMin > 0 && (
                        <span className="lrn-lesson__time">
                          <Clock aria-hidden="true" />
                          {formatDuration(l.durationMin, locale)}
                        </span>
                      )}
                      {quizLessonIds.has(l.id) && <Badge tone="neutral">{t('outline.quiz')}</Badge>}
                      {locked && <span>{t('outline.lockedHint')}</span>}
                    </span>
                  </span>
                  <span className="lrn-lesson__go">
                    {current && <span className="lrn-lesson__label">{started ? t('outline.continue') : t('outline.start')}</span>}
                    {locked ? <Lock aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                  </span>
                </>
              );
              return (
                <li key={l.id} className="lrn-lesson" data-state={l.state} data-current={current || undefined}>
                  {locked ? (
                    <div className="lrn-lesson__row" aria-disabled="true">
                      {body}
                    </div>
                  ) : (
                    <Link href={lessonPath(courseSlug, l.slug)} className="lrn-lesson__row">
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
    </div>
  );
}
