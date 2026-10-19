import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Block, LessonContent } from '../../src/lib/content/types';
import { attemptKey, contentHasQuiz, pickLessonDoc, quizBlocksOf, toPublicLesson } from '../../src/lib/learn/content';

const quiz: Block = {
  id: 'quiz',
  type: 'quiz',
  passScore: 70,
  questions: [
    { id: 'q1', text: 'Вопрос?', options: ['A', 'B'], correct: [1], multiple: false, explain: 'СЕКРЕТНОЕ-ПОЯСНЕНИЕ' },
    { id: 'q2', text: 'Несколько?', options: ['A', 'B', 'C'], correct: [0, 2], multiple: true },
  ],
};

const ru: LessonContent['ru'] = {
  v: 1,
  blocks: [
    { id: 'h', type: 'heading', level: 2, text: 'Заголовок' },
    { id: 't', type: 'text', markdown: 'Текст' },
    quiz,
  ],
};
const kzNoQuiz: LessonContent['ru'] = { v: 1, blocks: [{ id: 'h', type: 'heading', level: 2, text: 'Тақырып' }] };

test('pickLessonDoc: своя локаль, если в документе есть блоки', () => {
  const p = pickLessonDoc({ ru, kz: kzNoQuiz }, 'kz');
  assert.equal(p?.locale, 'kz');
  assert.equal(p?.fallback, false);
  assert.equal(p?.doc.blocks.length, 1);
});

test('pickLessonDoc: нет перевода или он пустой — запасной ru с пометкой', () => {
  const none = pickLessonDoc({ ru }, 'kz');
  assert.deepEqual([none?.locale, none?.fallback], ['ru', true]);
  const empty = pickLessonDoc({ ru, kz: { v: 1, blocks: [] } }, 'kz');
  assert.deepEqual([empty?.locale, empty?.fallback], ['ru', true]);
  const own = pickLessonDoc({ ru }, 'ru');
  assert.deepEqual([own?.locale, own?.fallback], ['ru', false]);
});

test('pickLessonDoc: битый контент → null, пустой/неизвестный — пустой документ', () => {
  assert.equal(pickLessonDoc({ ru: { v: 2, blocks: [] } }, 'ru'), null);
  assert.equal(pickLessonDoc({ ru: { v: 1, blocks: [{ id: 'x', type: 'unknown' }] } }, 'ru'), null);
  assert.deepEqual(pickLessonDoc({}, 'ru')?.doc.blocks, []);
  assert.deepEqual(pickLessonDoc(null, 'kz')?.doc.blocks, []);
});

test('pickLessonDoc: неизвестные поля отбрасываются схемой', () => {
  const dirty = { ru: { v: 1, blocks: [{ id: 't', type: 'text', markdown: 'x', correct: [0], secret: 'boo' }] } };
  const p = pickLessonDoc(dirty, 'ru');
  assert.deepEqual(p?.doc.blocks[0], { id: 't', type: 'text', markdown: 'x' });
});

test('attemptKey: ru — id блока как есть, остальные — с префиксом локали', () => {
  assert.equal(attemptKey('ru', 'quiz'), 'quiz');
  assert.equal(attemptKey('kz', 'quiz'), 'kz:quiz');
});

test('quizBlocksOf и contentHasQuiz учитывают документ показываемой локали', () => {
  assert.equal(quizBlocksOf(ru).length, 1);
  const content = { ru, kz: kzNoQuiz };
  assert.equal(contentHasQuiz(content, 'ru'), true);
  assert.equal(contentHasQuiz(content, 'kz'), false); // в kz-документе теста нет
  assert.equal(contentHasQuiz({ ru }, 'kz'), true); // перевода нет — показывается ru
  assert.equal(contentHasQuiz(null, 'ru'), false);
});

test('toPublicLesson: payload для клиента не содержит correct и explain', () => {
  const picked = pickLessonDoc({ ru }, 'ru');
  assert.ok(picked);
  const pub = toPublicLesson(picked);
  const json = JSON.stringify(pub);
  assert.equal(json.includes('correct'), false);
  assert.equal(json.includes('explain'), false);
  assert.equal(json.includes('СЕКРЕТНОЕ-ПОЯСНЕНИЕ'), false);
  // а всё нужное для отрисовки осталось
  const q = pub.blocks.find((b) => b.type === 'quiz');
  assert.ok(q && q.type === 'quiz');
  assert.deepEqual(
    q.questions.map((x) => [x.id, x.options.length, x.multiple]),
    [
      ['q1', 2, false],
      ['q2', 3, true],
    ],
  );
  assert.equal(q.passScore, 70);
});

test('toPublicLesson: чужие поля в блоках теста и других блоков не просачиваются', () => {
  const dirty = {
    ru: {
      v: 1,
      blocks: [
        { id: 't', type: 'text', markdown: 'x', correct: [1] },
        { ...quiz, answerKey: [1], questions: [{ ...(quiz as { questions: unknown[] }).questions[0] as object, hint: 'ответ B' }] },
      ],
    },
  };
  const picked = pickLessonDoc(dirty, 'ru');
  assert.ok(picked);
  const json = JSON.stringify(toPublicLesson(picked));
  for (const leak of ['correct', 'explain', 'answerKey', 'hint', 'ответ B']) assert.equal(json.includes(leak), false, leak);
});
