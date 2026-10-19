import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMissingKzQuizzes, kzQuizDiff, kzQuizzesInSync, removeExtraKzQuizzes } from '../../src/lib/admin/kzQuizzes';
import type { Block, QuizBlock } from '../../src/lib/content/types';

const quiz = (id: string, text: string): QuizBlock => ({
  id,
  type: 'quiz',
  passScore: 70,
  questions: [{ id: `${id}-q`, text, options: ['a', 'b'], correct: [0], multiple: false }],
});
const ru: Block[] = [
  { id: 'h', type: 'heading', level: 2, text: 'Заголовок' },
  quiz('q1', 'Вопрос 1'),
  { id: 't', type: 'text', markdown: 'Текст' },
  quiz('q2', 'Вопрос 2'),
];

test('kzQuizDiff: пустая kz-версия ни с чем не расходится', () => {
  assert.deepEqual(kzQuizDiff(ru, []), { missing: [], extra: [] });
  assert.equal(kzQuizzesInSync(ru, []), true);
});

test('kzQuizDiff: недостающие и лишние тесты по id блока', () => {
  const kz: Block[] = [{ id: 'h', type: 'heading', level: 2, text: 'Тақырып' }, quiz('q1', 'Сұрақ 1'), quiz('old', 'Ескі')];
  assert.deepEqual(kzQuizDiff(ru, kz), { missing: ['q2'], extra: ['old'] });
  assert.equal(kzQuizzesInSync(ru, kz), false);
});

test('addMissingKzQuizzes: дописывает копии недостающих тестов ru в конец, остальное kz не трогает', () => {
  const kz: Block[] = [{ id: 'h', type: 'heading', level: 2, text: 'Тақырып' }, quiz('q1', 'Сұрақ 1')];
  const next = addMissingKzQuizzes(ru, kz);
  assert.equal(next.length, 3);
  assert.deepEqual(next.slice(0, 2), kz, 'переведённые блоки на месте');
  assert.deepEqual(next[2], ru[3], 'тест q2 с тем же id и русским текстом-заготовкой');
  assert.notEqual(next[2], ru[3], 'копия, а не ссылка на блок ru');
  (next[2] as QuizBlock).questions[0]!.text = 'Аударма';
  assert.equal((ru[3] as QuizBlock).questions[0]!.text, 'Вопрос 2', 'правка копии не меняет ru');
  assert.equal(kzQuizzesInSync(ru, next), true);
  // повтор ничего не добавляет
  assert.equal(addMissingKzQuizzes(ru, next).length, 3);
});

test('removeExtraKzQuizzes: убирает только тесты, которых нет в ru', () => {
  const kz: Block[] = [quiz('q1', 'Сұрақ 1'), { id: 'x', type: 'divider' }, quiz('q2', 'Сұрақ 2'), quiz('deleted-in-ru', 'Жойылған')];
  const next = removeExtraKzQuizzes(ru, kz);
  assert.deepEqual(next.map((b) => b.id), ['q1', 'x', 'q2']);
  assert.equal(kzQuizzesInSync(ru, next), true);
});
