'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button } from '@/components/ui';
import type { PublicQuizBlock } from '@/lib/content/types';
import { submitQuizAction } from '@/lib/learn/actions';
import type { ActionError, QuizResult, QuizStatus } from '@/lib/learn/types';
import { useLessonRuntime } from './LessonRuntime';
import './learn.css';

type Props = {
  lessonId: string;
  locale: 'ru' | 'kz';
  block: PublicQuizBlock;
  /** Результат прошлых попыток (без ответов) — для пометки «уже сдан». */
  initial: QuizStatus | null;
};

/**
 * Тест. Варианты приходят без правильных ответов; результат — из server action после отправки.
 * Провал — только «не сдан» (ни счёта, ни разбора по вопросам, D-020); сдан — счёт, разбор и пояснения.
 * Можно пересдавать без ограничений.
 */
export function QuizBlock({ lessonId, locale, block, initial }: Props) {
  const t = useTranslations('learn');
  const runtime = useLessonRuntime();
  const titleId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const [answers, setAnswers] = useState<number[][]>(() => block.questions.map(() => []));
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  const answered = answers.every((a) => a.length > 0);
  const locked = result !== null || pending;

  useEffect(() => {
    if (result) resultRef.current?.focus({ preventScroll: false });
  }, [result]);

  function choose(qi: number, oi: number, multiple: boolean) {
    setAnswers((prev) =>
      prev.map((a, i) => {
        if (i !== qi) return a;
        if (!multiple) return [oi];
        return a.includes(oi) ? a.filter((x) => x !== oi) : [...a, oi].sort((x, y) => x - y);
      }),
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!answered || locked) return;
    setError(null);
    startTransition(async () => {
      const res = await submitQuizAction({ lessonId, blockId: block.id, answers, locale });
      if (res.ok) {
        setResult(res.data);
        if (res.data.passed) runtime.markPassed(block.id);
      } else {
        setError(res.error);
      }
    });
  }

  function retry() {
    setResult(null);
    setError(null);
    setAnswers(block.questions.map(() => []));
  }

  return (
    <section className="lrn-quiz" aria-labelledby={titleId} data-testid="quiz">
      <header className="lrn-quiz__head">
        <div>
          <h3 id={titleId} className="lrn-quiz__title">
            {t('quiz.title')}
          </h3>
          <p className="meta">{t('quiz.meta', { count: block.questions.length, score: block.passScore })}</p>
        </div>
        {initial?.passed && !result && (
          <Badge tone="success" dot>
            {t('quiz.passedBadge')}
          </Badge>
        )}
      </header>

      <form className="lrn-quiz__form" onSubmit={submit} noValidate>
        {initial?.passed && !result && (
          <Alert tone="success">{t('quiz.previously', { pct: initial.bestPct ?? 100 })}</Alert>
        )}

        <ol className="lrn-quiz__list">
          {block.questions.map((q, qi) => {
            const r = result?.passed ? result.perQuestion[qi] : undefined;
            return (
              <li key={q.id} className="lrn-q" data-result={r ? (r.correct ? 'ok' : 'bad') : undefined}>
                <fieldset disabled={locked}>
                  <legend className="lrn-q__text">
                    <span className="lrn-q__num" aria-hidden="true">
                      {qi + 1}
                    </span>
                    <span>{q.text}</span>
                  </legend>
                  <p className="lrn-q__hint">{q.multiple ? t('quiz.multiple') : t('quiz.single')}</p>
                  <div className="lrn-q__options">
                    {q.options.map((option, oi) => (
                      <label key={oi} className="lrn-opt">
                        <input
                          type={q.multiple ? 'checkbox' : 'radio'}
                          name={`${block.id}-${q.id}`}
                          checked={answers[qi]?.includes(oi) ?? false}
                          onChange={() => choose(qi, oi, q.multiple)}
                        />
                        <span className="lrn-opt__mark" aria-hidden="true" />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                  {r && (
                    <div className="lrn-q__feedback" role="status">
                      {r.correct ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                      <div>
                        <strong className="lrn-q__verdict">{r.correct ? t('quiz.correct') : t('quiz.wrong')}</strong>
                        {r.explain && <span>{r.explain}</span>}
                      </div>
                    </div>
                  )}
                </fieldset>
              </li>
            );
          })}
        </ol>

        {error && <Alert tone="error">{t(`errors.${error}`)}</Alert>}

        {result ? (
          <div ref={resultRef} tabIndex={-1} className="lrn-result" data-passed={result.passed} aria-live="polite">
            {result.passed && (
              <div className="lrn-result__score">
                <strong>{t('quiz.score', { correct: result.correct, total: result.total })}</strong>
                <span>{result.scorePct}%</span>
              </div>
            )}
            <div className="lrn-result__text">
              <Badge tone={result.passed ? 'success' : 'warning'} dot>
                {result.passed ? t('quiz.passed') : t('quiz.failed')}
              </Badge>
              <p data-testid="quiz-result-text">
                {result.passed ? t('quiz.passedText', { score: result.passScore }) : t('quiz.failedText')}
              </p>
            </div>
            <Button variant={result.passed ? 'ghost' : 'primary'} size="sm" onClick={retry}>
              {t('quiz.retry')}
            </Button>
          </div>
        ) : (
          <div className="lrn-quiz__foot">
            <Button type="submit" disabled={!answered || pending} aria-busy={pending || undefined}>
              {pending && <span className="spinner" aria-hidden="true" />}
              {pending ? t('quiz.submitting') : t('quiz.submit')}
            </Button>
            {!answered && <span className="lrn-quiz__foot-hint">{t('quiz.answerAll')}</span>}
          </div>
        )}
      </form>
    </section>
  );
}
