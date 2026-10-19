// Подсчёт теста — только на сервере. Вопрос засчитывается при точном совпадении множества ответов.
import type { QuizBlock } from '../content/types';
import type { QuizResult } from './types';

/** Множества индексов совпадают (порядок и повторы не важны). */
export function sameSet(a: readonly number[], b: readonly number[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Форма ответов: по массиву на каждый вопрос, индексы целые, в пределах options, без повторов;
 * в вопросе с одним ответом — не больше одного. Пустой массив — «без ответа» (неверно).
 */
export function validateAnswers(block: QuizBlock, answers: readonly (readonly number[])[]): boolean {
  if (answers.length !== block.questions.length) return false;
  return block.questions.every((q, i) => {
    const a = answers[i];
    if (!a) return false;
    if (!q.multiple && a.length > 1) return false;
    if (new Set(a).size !== a.length) return false;
    return a.every((x) => Number.isInteger(x) && x >= 0 && x < q.options.length);
  });
}

/** Оценка попытки для сервера: счёт хранится в quiz_attempts, клиенту уходит только result. */
export type QuizGrade = {
  correct: number;
  total: number;
  scorePct: number;
  passed: boolean;
  /** Ответ клиенту (D-020): провал — только { passed: false }; сдан — счёт, разбор и пояснения. */
  result: QuizResult;
};

/**
 * Оценка попытки: correct — число точно угаданных вопросов, scorePct = round(correct / total × 100),
 * passed = scorePct ≥ passScore. Провал — клиенту ни счёта, ни разбора: по счёту подбирают ответы,
 * меняя по одному. Сдан — счёт, разбор по вопросам и пояснения (единственное место, где они уходят).
 */
export function gradeQuiz(block: QuizBlock, answers: readonly (readonly number[])[]): QuizGrade {
  const total = block.questions.length;
  const marks = block.questions.map((q, i) => sameSet(q.correct, answers[i] ?? []));
  const correct = marks.filter(Boolean).length;
  const scorePct = total === 0 ? 0 : Math.round((correct / total) * 100);
  if (scorePct < block.passScore) return { correct, total, scorePct, passed: false, result: { passed: false } };
  const perQuestion = block.questions.map((q, i) =>
    q.explain ? { correct: marks[i] as boolean, explain: q.explain } : { correct: marks[i] as boolean },
  );
  return {
    correct,
    total,
    scorePct,
    passed: true,
    result: { passed: true, correct, total, scorePct, passScore: block.passScore, perQuestion },
  };
}

/** Ответ клиенту на попытку (см. gradeQuiz). */
export function scoreQuiz(block: QuizBlock, answers: readonly (readonly number[])[]): QuizResult {
  return gradeQuiz(block, answers).result;
}
