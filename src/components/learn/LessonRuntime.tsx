'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CompleteData } from '@/lib/learn/types';

type Runtime = {
  lessonId: string;
  locale: 'ru' | 'kz';
  /** Id тестов в показываемом документе: без них нельзя завершить урок. */
  requiredQuizIds: readonly string[];
  /** Сколько обязательных тестов ещё не сдано. */
  quizzesLeft: number;
  markPassed: (blockId: string) => void;
  completed: boolean;
  /** Итог последней отметки «пройден» в этой сессии страницы. */
  lastResult: CompleteData | null;
  setCompleted: (result: CompleteData) => void;
};

const Ctx = createContext<Runtime | null>(null);

type Props = {
  lessonId: string;
  locale: 'ru' | 'kz';
  requiredQuizIds: string[];
  initialPassed: string[];
  initialCompleted: boolean;
  children: ReactNode;
};

/**
 * Общее состояние урока для тестов и кнопки «Урок пройден»: какие тесты сданы, пройден ли урок.
 * На странице ставится с key={lessonId}, чтобы состояние не переезжало на соседний урок.
 * Это только подсказки интерфейса — проверку делает сервер.
 */
export function LessonRuntime({ lessonId, locale, requiredQuizIds, initialPassed, initialCompleted, children }: Props) {
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set(initialPassed));
  const [completed, setCompletedState] = useState(initialCompleted);
  const [lastResult, setLastResult] = useState<CompleteData | null>(null);

  const markPassed = useCallback((id: string) => setPassed((p) => (p.has(id) ? p : new Set(p).add(id))), []);
  const setCompleted = useCallback((r: CompleteData) => {
    setCompletedState(true);
    setLastResult(r);
  }, []);

  const value = useMemo<Runtime>(
    () => ({
      lessonId,
      locale,
      requiredQuizIds,
      quizzesLeft: requiredQuizIds.filter((id) => !passed.has(id)).length,
      markPassed,
      completed,
      lastResult,
      setCompleted,
    }),
    [lessonId, locale, requiredQuizIds, passed, markPassed, completed, lastResult, setCompleted],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLessonRuntime(): Runtime {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLessonRuntime: нужен <LessonRuntime>');
  return ctx;
}
