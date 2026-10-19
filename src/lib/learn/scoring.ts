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

/**
 * Результат попытки: correct — число точно угаданных вопросов, scorePct = round(correct / total × 100),
 * passed = scorePct ≥ passScore. Пояснения возвращаются только здесь — после попытки.
 */
export function scoreQuiz(block: QuizBlock, answers: readonly (readonly number[])[]): QuizResult {
  const total = block.questions.length;
  const perQuestion = block.questions.map((q, i) => {
    const ok = sameSet(q.correct, answers[i] ?? []);
    return q.explain ? { correct: ok, explain: q.explain } : { correct: ok };
  });
  const correct = perQuestion.filter((p) => p.correct).length;
  const scorePct = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { correct, total, scorePct, passed: scorePct >= block.passScore, passScore: block.passScore, perQuestion };
}
