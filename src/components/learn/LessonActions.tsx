'use client';

import { useId, useState, useTransition, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';
import { useRouter } from '@/lib/i18n/navigation';
import { markCompleteAction } from '@/lib/learn/actions';
import type { ActionError } from '@/lib/learn/types';
import { useLessonRuntime } from './LessonRuntime';
import './learn.css';

type Target = { href: string; title: string };

type Props = {
  /** Путь программы курса (без локали). */
  courseHref: string;
  prev: Target | null;
  next: Target | null;
  /** Следующий урок доступен уже сейчас (свободный порядок). */
  nextOpenNow: boolean;
  /** Курс уже пройден полностью на момент загрузки страницы. */
  courseComplete: boolean;
  isLast: boolean;
  /** Экран завершения курса (серверный компонент) — показываем, когда курс пройден. */
  completionSlot: ReactNode;
};

/** Низ урока: «Урок пройден», назад/дальше, экран завершения курса. */
export function LessonActions({ courseHref, prev, next, nextOpenNow, courseComplete, isLast, completionSlot }: Props) {
  const t = useTranslations('learn');
  const router = useRouter();
  const runtime = useLessonRuntime();
  const hintId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  const { completed, quizzesLeft, lastResult } = runtime;
  const blocked = quizzesLeft > 0;
  const justFinishedCourse = lastResult?.courseComplete === true;
  const showCompletion = completed && (courseComplete || justFinishedCourse) && (isLast || justFinishedCourse);

  function complete() {
    setError(null);
    startTransition(async () => {
      const res = await markCompleteAction({ lessonId: runtime.lessonId, locale: runtime.locale });
      if (res.ok) {
        runtime.setCompleted(res.data);
        router.refresh(); // обновить отметки в оглавлении и прогресс
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="lrn-actions" data-testid="lesson-actions">
      {completed && lastResult && (
        <Alert tone="success" title={t('actions.completedTitle')} data-testid="lesson-completed-note">
          {t('actions.completedText', { done: lastResult.done, total: lastResult.total })}
        </Alert>
      )}

      {!completed && blocked && (
        <p id={hintId} className="lrn-actions__hint">
          {t('actions.quizHint', { count: quizzesLeft })}
        </p>
      )}
      {error && <Alert tone="error">{t(`errors.${error}`)}</Alert>}

      <div className="lrn-actions__row">
        {prev && (
          <Button href={prev.href} variant="ghost" aria-label={`${t('actions.prev')}: ${prev.title}`}>
            {t('actions.prev')}
          </Button>
        )}
        <span className="lrn-actions__spacer" />
        {!completed && next && nextOpenNow && (
          <Button href={next.href} variant="ghost" aria-label={`${t('actions.skip')}: ${next.title}`}>
            {t('actions.skip')}
          </Button>
        )}
        {!completed ? (
          <Button
            size="lg"
            onClick={complete}
            disabled={blocked || pending}
            aria-describedby={blocked ? hintId : undefined}
            aria-busy={pending || undefined}
            data-testid="complete-lesson"
          >
            {pending && <span className="spinner" aria-hidden="true" />}
            {pending ? t('actions.completing') : t('actions.complete')}
          </Button>
        ) : next ? (
          <Button href={next.href} size="lg" data-testid="next-lesson" aria-label={`${t('actions.next')}: ${next.title}`}>
            {t('actions.next')}
          </Button>
        ) : !showCompletion ? (
          <Button href={courseHref} size="lg">
            {t('actions.toCourse')}
          </Button>
        ) : null}
      </div>

      {showCompletion && completionSlot}
    </div>
  );
}
