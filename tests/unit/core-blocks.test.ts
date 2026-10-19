import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS, lessonContentSchema, lessonDocSchema, toPublicBlocks, validateLessonContent } from '../../src/lib/content/blocks';
import type { Block, LessonDoc } from '../../src/lib/content/types';

const quiz: Block = {
  id: 'q1',
  type: 'quiz',
  passScore: 70,
  questions: [
    { id: 'a', text: 'Вопрос 1', options: ['Да', 'Нет'], correct: [0], multiple: false, explain: 'Потому что' },
    { id: 'b', text: 'Вопрос 2', options: ['A', 'B', 'C'], correct: [0, 2], multiple: true },
  ],
};

const doc: LessonDoc = {
  v: 1,
  blocks: [
    { id: 'h', type: 'heading', level: 2, text: 'Заголовок' },
    { id: 't', type: 'text', markdown: '**Текст**' },
    { id: 'v1', type: 'video', provider: 'placeholder', caption: 'Скоро' },
    { id: 'v2', type: 'video', provider: 'youtube', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'c', type: 'callout', tone: 'warn', text: 'Важно' },
    { id: 'd', type: 'divider' },
    quiz,
  ],
};

function withBlock(b: unknown): unknown {
  return { v: 1, blocks: [b] };
}

test('валидный документ со всеми типами блоков', () => {
  assert.equal(lessonDocSchema.safeParse(doc).success, true);
  assert.equal(validateLessonContent({ ru: doc }).success, true);
  assert.equal(validateLessonContent({ ru: doc, kz: doc }).success, true);
});

test('контент: ru обязателен, лишние версии отклоняются', () => {
  assert.equal(lessonContentSchema.safeParse({ kz: doc }).success, false);
  assert.equal(lessonDocSchema.safeParse({ v: 2, blocks: [] }).success, false);
});

test('невалидные блоки', () => {
  const bad: unknown[] = [
    { id: 'x', type: 'unknown' },
    { id: 'x', type: 'heading', level: 1, text: 'a' },
    { id: 'x', type: 'heading', level: 2, text: '' },
    { id: 'x', type: 'text', markdown: 'a'.repeat(LIMITS.markdown + 1) },
    { id: 'x', type: 'video', provider: 'youtube' },
    { id: 'x', type: 'video', provider: 'youtube', youtubeId: 'bad id' },
    { id: 'x', type: 'video', provider: 'vimeo' },
    { id: 'x', type: 'callout', tone: 'danger', text: 'a' },
    { id: '', type: 'divider' },
    { ...quiz, passScore: 0 },
    { ...quiz, passScore: 101 },
    { ...quiz, questions: [] },
    { ...quiz, questions: [{ id: 'a', text: 'q', options: ['1'], correct: [0], multiple: false }] },
    { ...quiz, questions: [{ id: 'a', text: 'q', options: Array(9).fill('o'), correct: [0], multiple: false }] },
    { ...quiz, questions: [{ id: 'a', text: 'q', options: ['1', '2'], correct: [2], multiple: false }] },
    { ...quiz, questions: [{ id: 'a', text: 'q', options: ['1', '2'], correct: [], multiple: true }] },
    { ...quiz, questions: [{ id: 'a', text: 'q', options: ['1', '2'], correct: [0, 1], multiple: false }] },
    { ...quiz, questions: [{ id: 'a', text: 'q', options: ['1', '2'], correct: [1, 1], multiple: true }] },
    {
      ...quiz,
      questions: [
        { id: 'a', text: 'q', options: ['1', '2'], correct: [0], multiple: false },
        { id: 'a', text: 'q2', options: ['1', '2'], correct: [0], multiple: false },
      ],
    },
  ];
  for (const b of bad) assert.equal(lessonDocSchema.safeParse(withBlock(b)).success, false, JSON.stringify(b).slice(0, 80));
});

test('дубли id блоков и слишком большой документ', () => {
  const dup = { v: 1, blocks: [{ id: 'd', type: 'divider' }, { id: 'd', type: 'divider' }] };
  assert.equal(lessonDocSchema.safeParse(dup).success, false);
  const big = {
    v: 1,
    blocks: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, type: 'text', markdown: 'я'.repeat(19_000) })),
  };
  assert.equal(lessonDocSchema.safeParse(big).success, false);
});

test('toPublicBlocks убирает correct и explain, не меняя исходник', () => {
  const before = JSON.stringify(doc.blocks);
  const pub = toPublicBlocks(doc.blocks);
  assert.equal(JSON.stringify(doc.blocks), before);
  const json = JSON.stringify(pub);
  assert.equal(json.includes('"correct"'), false);
  assert.equal(json.includes('"explain"'), false);
  assert.equal(json.includes('Потому что'), false);
  const q = pub.find((b) => b.type === 'quiz');
  assert.ok(q && q.type === 'quiz');
  assert.deepEqual(q.questions[0], { id: 'a', text: 'Вопрос 1', options: ['Да', 'Нет'], multiple: false });
  assert.equal(q.passScore, 70);
  // остальные блоки без изменений
  assert.deepEqual(pub.slice(0, 6), doc.blocks.slice(0, 6));
});
