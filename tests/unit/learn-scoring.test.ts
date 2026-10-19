import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QuizBlock } from '../../src/lib/content/types';
import { sameSet, scoreQuiz, validateAnswers } from '../../src/lib/learn/scoring';
import type { QuizResult } from '../../src/lib/learn/types';

/** Разбор по вопросам есть только у сданной попытки. */
function marks(r: QuizResult): boolean[] {
  assert.equal(r.passed, true, 'разбор есть только у сданной попытки');
  return r.passed ? r.perQuestion.map((p) => p.correct) : [];
}

const quiz: QuizBlock = {
  id: 'quiz',
  type: 'quiz',
  passScore: 60,
  questions: [
    { id: 'a', text: 'Один ответ', options: ['x', 'y', 'z'], correct: [1], multiple: false, explain: 'Потому что y' },
    { id: 'b', text: 'Несколько', options: ['p', 'q', 'r', 's'], correct: [0, 2], multiple: true },
    { id: 'c', text: 'Ещё один', options: ['да', 'нет'], correct: [0], multiple: false, explain: 'Да.' },
  ],
};

test('sameSet: порядок и повторы не важны, лишний или недостающий индекс — несовпадение', () => {
  assert.equal(sameSet([0, 2], [2, 0]), true);
  assert.equal(sameSet([1], [1, 1]), true);
  assert.equal(sameSet([0, 2], [0]), false);
  assert.equal(sameSet([0, 2], [0, 1, 2]), false);
  assert.equal(sameSet([], []), true);
  assert.equal(sameSet([0], []), false);
});

test('scoreQuiz: все верно — 100 %, сдан', () => {
  const r = scoreQuiz(quiz, [[1], [2, 0], [0]]);
  assert.deepEqual([r.correct, r.total, r.scorePct, r.passed], [3, 3, 100, true]);
  assert.deepEqual(marks(r), [true, true, true]);
});

test('scoreQuiz: множественный выбор — только точное совпадение (подмножество и надмножество не засчитываются)', () => {
  assert.equal(marks(scoreQuiz(quiz, [[1], [0], [0]]))[1], false); // не все верные (2 из 3 — сдан)
  assert.equal(marks(scoreQuiz(quiz, [[1], [0, 1, 2], [0]]))[1], false); // лишний вариант
  assert.equal(marks(scoreQuiz(quiz, [[1], [0, 2], [0]]))[1], true);
});

test('scoreQuiz: провал — только счёт, без разбора по вопросам и пояснений (D-020)', () => {
  const r = scoreQuiz(quiz, [[0], [0], [0]]); // 1 из 3 — не сдан
  assert.deepEqual(r, { passed: false, correct: 1, total: 3, scorePct: 33 });
  const json = JSON.stringify(r);
  for (const leak of ['perQuestion', 'explain', 'Потому что y', 'Да.', 'passScore']) assert.equal(json.includes(leak), false, leak);
});

test('scoreQuiz: scorePct = round(correct / total × 100); passed = scorePct ≥ passScore', () => {
  const two = scoreQuiz(quiz, [[1], [0, 2], [1]]); // 2 из 3
  assert.deepEqual([two.correct, two.scorePct, two.passed], [2, 67, true]);
  const one = scoreQuiz(quiz, [[1], [0], [1]]); // 1 из 3
  assert.deepEqual([one.correct, one.scorePct, one.passed], [1, 33, false]);
  // граница: ровно проходной балл — сдан
  const edge: QuizBlock = { ...quiz, passScore: 67 };
  assert.equal(scoreQuiz(edge, [[1], [0, 2], [1]]).passed, true);
  assert.equal(scoreQuiz({ ...quiz, passScore: 68 }, [[1], [0, 2], [1]]).passed, false);
});

test('scoreQuiz: вопрос без ответа считается неверным', () => {
  const r = scoreQuiz(quiz, [[], [], []]);
  assert.deepEqual([r.correct, r.scorePct, r.passed], [0, 0, false]);
});

test('scoreQuiz: сдан — разбор и пояснения только у вопросов, где они заданы', () => {
  const r = scoreQuiz(quiz, [[0], [0, 2], [0]]); // 2 из 3 — сдан, первый неверен
  assert.ok(r.passed);
  assert.equal(r.passScore, 60);
  assert.deepEqual(r.perQuestion[0], { correct: false, explain: 'Потому что y' });
  assert.equal('explain' in (r.perQuestion[1] ?? {}), false);
  assert.equal(r.perQuestion[2]?.explain, 'Да.');
});

test('validateAnswers: длина, диапазон, повторы, одиночный выбор', () => {
  assert.equal(validateAnswers(quiz, [[1], [0, 2], [0]]), true);
  assert.equal(validateAnswers(quiz, [[], [], []]), true); // «без ответа» допустимо
  assert.equal(validateAnswers(quiz, [[1], [0, 2]]), false); // не хватает вопроса
  assert.equal(validateAnswers(quiz, [[1], [0, 2], [0], [0]]), false); // лишний вопрос
  assert.equal(validateAnswers(quiz, [[3], [0], [0]]), false); // вне options
  assert.equal(validateAnswers(quiz, [[-1], [0], [0]]), false);
  assert.equal(validateAnswers(quiz, [[0.5], [0], [0]]), false);
  assert.equal(validateAnswers(quiz, [[0, 1], [0], [0]]), false); // одиночный: два ответа
  assert.equal(validateAnswers(quiz, [[1], [0, 0], [0]]), false); // повтор индекса
});
