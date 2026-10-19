// Тесты урока: подсчёт попытки и статус сданных блоков. Ответы и правильные варианты клиенту не уходят.
import type { Locale } from '../content/types';
import { getDb, newId, now, type Sql } from '../db';
import { attemptKey, quizBlocksOf } from './content';
import { LearnError } from './errors';
import { loadLessonForAction } from './gate';
import { gradeQuiz, validateAnswers } from './scoring';
import type { QuizResult, QuizStatus } from './types';

export type SubmitQuizInput = {
  userId: string;
  lessonId: string;
  blockId: string;
  answers: number[][];
  locale: Locale;
};

/**
 * Принять попытку. Урок и тест перечитываются из БД (по документу текущей локали),
 * доступ и порядок прохождения проверяются заново; считаем на сервере; попытка сохраняется всегда.
 */
export async function submitQuiz(input: SubmitQuizInput): Promise<QuizResult> {
  const { picked } = await loadLessonForAction(input.userId, input.lessonId, input.locale);
  const block = quizBlocksOf(picked.doc).find((b) => b.id === input.blockId);
  if (!block) throw new LearnError('not_found');
  if (!validateAnswers(block, input.answers)) throw new LearnError('invalid');

  const grade = gradeQuiz(block, input.answers);
  const db = await getDb();
  await db.sql`
    INSERT INTO quiz_attempts (id, user_id, lesson_id, block_id, correct, total, passed, created_at)
    VALUES (${newId()}, ${input.userId}, ${input.lessonId}, ${attemptKey(picked.locale, block.id)},
            ${grade.correct}, ${grade.total}, ${grade.passed}, ${now()})`;
  return grade.result;
}

/**
 * Статус по каждому блоку теста урока: число попыток, сдан ли, лучший результат сданных попыток.
 * Ключ — attemptKey. Счёт проваленных попыток сюда не попадает: статус уходит на клиент (D-020).
 */
export async function getQuizStatuses(userId: string, lessonId: string, sql?: Sql): Promise<Map<string, QuizStatus>> {
  const s = sql ?? (await getDb()).sql;
  const rows = await s<{ blockId: string; correct: number; total: number; passed: boolean }>`
    SELECT block_id, correct, total, passed FROM quiz_attempts WHERE user_id = ${userId} AND lesson_id = ${lessonId}`;
  const out = new Map<string, QuizStatus>();
  for (const r of rows) {
    const pct = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
    const cur = out.get(r.blockId) ?? { attempts: 0, passed: false, bestPct: null };
    out.set(r.blockId, {
      attempts: cur.attempts + 1,
      passed: cur.passed || r.passed,
      bestPct: !r.passed ? cur.bestPct : cur.bestPct === null ? pct : Math.max(cur.bestPct, pct),
    });
  }
  return out;
}
