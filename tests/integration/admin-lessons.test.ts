import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  AdminError,
  addLesson,
  addModule,
  createCourse,
  getLessonForEdit,
  updateLesson,
  type LessonSaveInput,
} from '../../src/lib/admin';
import { RESERVED_LESSON_SLUGS } from '../../src/lib/admin/slug';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;
const admin = { id: 'adm', role: 'admin' };
const learner = { id: 'lrn', role: 'learner' };
let courseId = '';
let lessonId = '';

const goodQuiz = {
  id: 'quiz1',
  type: 'quiz' as const,
  passScore: 70,
  questions: [
    { id: 'q1', text: 'Сколько будет 2+2?', options: ['3', '4', '5'], correct: [1], multiple: false },
    { id: 'q2', text: 'Простые числа', options: ['2', '3', '4'], correct: [0, 1], multiple: true, explain: '2 и 3' },
  ],
};

function save(over: Partial<LessonSaveInput> = {}, blocksRu: unknown[] = [goodQuiz]): Promise<{ slug: string }> {
  return updateLesson(admin, courseId, lessonId, {
    titleRu: 'Урок',
    titleKz: 'Сабақ',
    status: 'draft',
    durationMin: '12',
    content: { ru: { v: 1, blocks: blocksRu } },
    ...over,
  });
}

async function fails(p: Promise<unknown>): Promise<AdminError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof AdminError, `ожидалась AdminError, получено ${String(e)}`);
    assert.equal(e.code, 'VALIDATION');
    return e;
  }
  assert.fail('ожидалась ошибка VALIDATION');
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('adm', 'adm@x.kz', 'Админ', 'admin', 1), ('lrn', 'lrn@x.kz', 'Слушатель', 'learner', 1)`;
  courseId = (await createCourse(admin, { titleRu: 'Курс' })).id;
  const m = await addModule(admin, courseId, { titleRu: 'Модуль' });
  lessonId = (await addLesson(admin, m.id, { titleRu: 'Урок' })).id;
});
after(async () => {
  await db.close();
});

test('корректный контент сохраняется и читается обратно', async () => {
  await save({}, [
    { id: 'h1', type: 'heading', level: 2, text: 'Заголовок' },
    { id: 't1', type: 'text', markdown: '**Привет**' },
    { id: 'v1', type: 'video', provider: 'youtube', youtubeId: 'dQw4w9WgXcQ', caption: 'Ролик' },
    { id: 'c1', type: 'callout', tone: 'warn', text: 'Важно' },
    { id: 'd1', type: 'divider' },
    goodQuiz,
  ]);
  const l = await getLessonForEdit(admin, courseId, lessonId);
  assert.ok(l);
  assert.equal(l.content.ru.blocks.length, 6);
  assert.deepEqual(l.title, { ru: 'Урок', kz: 'Сабақ' });
  assert.equal(l.durationMin, 12);
  assert.equal(l.status, 'draft');
  assert.equal(l.content.kz, undefined);
  assert.equal(l.courseSlug, 'kurs');
});

test('плохой тест отклоняется: нет правильного ответа, индекс вне диапазона, лишние правильные', async () => {
  const bad = (q: Record<string, unknown>) => ({ ...goodQuiz, questions: [{ ...goodQuiz.questions[0], ...q }] });

  let e = await fails(save({}, [bad({ correct: [] })]));
  assert.equal(e.fields?.content, 'invalid');
  assert.ok(e.issues?.some((i) => i.path.join('.') === 'ru.blocks.0.questions.0.correct'));

  e = await fails(save({}, [bad({ correct: [7] })]));
  assert.ok(e.issues?.some((i) => i.message === 'index out of range'));

  e = await fails(save({}, [bad({ correct: [0, 1], multiple: false })]));
  assert.ok(e.issues?.some((i) => i.message.includes('single-choice')));

  e = await fails(save({}, [bad({ options: ['только один'], correct: [0] })]));
  assert.ok(e.issues?.some((i) => i.path.join('.') === 'ru.blocks.0.questions.0.options'));

  e = await fails(save({}, [bad({ text: '' })]));
  assert.ok(e.issues?.some((i) => i.path.join('.') === 'ru.blocks.0.questions.0.text'));

  e = await fails(save({}, [{ ...goodQuiz, passScore: 0 }]));
  assert.ok(e.issues?.some((i) => i.path.join('.') === 'ru.blocks.0.passScore'));

  // ничего из плохого не записалось
  const l = await getLessonForEdit(admin, courseId, lessonId);
  assert.equal(l?.content.ru.blocks.length, 6);
});

test('плохие блоки: пустой заголовок, youtube без id, дубль id, неизвестный тип', async () => {
  let e = await fails(save({}, [{ id: 'h', type: 'heading', level: 2, text: '' }]));
  assert.ok(e.issues?.some((i) => i.path.join('.') === 'ru.blocks.0.text'));

  e = await fails(save({}, [{ id: 'v', type: 'video', provider: 'youtube' }]));
  assert.ok(e.issues?.some((i) => i.path.join('.') === 'ru.blocks.0.youtubeId'));

  e = await fails(save({}, [{ id: 'v', type: 'video', provider: 'youtube', youtubeId: 'слишком-коротко' }]));
  assert.ok(e.issues?.length);

  e = await fails(
    save({}, [
      { id: 'dup', type: 'divider' },
      { id: 'dup', type: 'divider' },
    ]),
  );
  assert.ok(e.issues?.some((i) => i.message === 'duplicate block id'));

  e = await fails(save({}, [{ id: 'x', type: 'carousel' }]));
  assert.ok(e.issues?.length);

  e = await fails(updateLesson(admin, courseId, lessonId, { titleRu: 'Урок', status: 'draft', content: 'мусор' }));
  assert.equal(e.fields?.content, 'invalid');
});

test('ошибки метаданных приходят вместе с ошибками контента', async () => {
  const e = await fails(
    save({ titleRu: '', slug: 'Плохой Slug', durationMin: 'много', status: 'archived' }, [{ id: 'h', type: 'heading', level: 2, text: '' }]),
  );
  assert.equal(e.fields?.titleRu, 'required');
  assert.equal(e.fields?.slug, 'slugFormat');
  assert.equal(e.fields?.durationMin, 'notNumber');
  assert.equal(e.fields?.status, 'invalid');
  assert.equal(e.fields?.content, 'invalid');
  assert.ok(e.issues?.length);
});

test('казахская версия: пустая не сохраняется, непустая проверяется отдельно', async () => {
  const ru = [{ id: 't', type: 'text', markdown: 'Привет' }];
  await save({ content: { ru: { v: 1, blocks: ru }, kz: { v: 1, blocks: [] } } });
  assert.equal((await getLessonForEdit(admin, courseId, lessonId))?.content.kz, undefined);

  await save({
    content: { ru: { v: 1, blocks: ru }, kz: { v: 1, blocks: [{ id: 't', type: 'text', markdown: 'Сәлем' }] } },
  });
  const l = await getLessonForEdit(admin, courseId, lessonId);
  assert.equal(l?.content.kz?.blocks.length, 1);

  const e = await fails(
    save({
      content: { ru: { v: 1, blocks: ru }, kz: { v: 1, blocks: [{ id: 'q', type: 'quiz', passScore: 50, questions: [] }] } },
    }),
  );
  assert.ok(e.issues?.some((i) => i.path[0] === 'kz'));
});

test('slug урока: смена, занятость, пустой — прежний', async () => {
  const m = await addModule(admin, courseId, { titleRu: 'Ещё' });
  const other = await addLesson(admin, m.id, { titleRu: 'Занятый адрес' });
  const r1 = await save({ slug: 'novyy-adres' });
  assert.equal(r1.slug, 'novyy-adres');
  const r2 = await save({ slug: '' });
  assert.equal(r2.slug, 'novyy-adres');
  const e = await updateLesson(admin, courseId, lessonId, {
    titleRu: 'Урок',
    status: 'draft',
    slug: other.slug,
    content: { ru: { v: 1, blocks: [] } },
  }).catch((x: unknown) => x);
  assert.ok(e instanceof AdminError);
  assert.equal(e.code, 'SLUG_TAKEN');
});

test('казахская версия с тестами: те же id тестов, что в русской, иначе KZ_QUIZ_MISMATCH (D-020)', async () => {
  const ru = [{ id: 't', type: 'text', markdown: 'Текст' }, goodQuiz];
  const kzText = { id: 't', type: 'text', markdown: 'Мәтін' };
  const before = JSON.stringify((await getLessonForEdit(admin, courseId, lessonId))?.content);
  const mismatch = async (kz: unknown[]) => {
    const e = await save({ content: { ru: { v: 1, blocks: ru }, kz: { v: 1, blocks: kz } } }).catch((x: unknown) => x);
    assert.ok(e instanceof AdminError, String(e));
    assert.equal(e.code, 'KZ_QUIZ_MISMATCH');
    assert.equal(e.fields?.content, 'kzQuizMismatch');
  };
  await mismatch([kzText]); // перевод без теста — слушатель в kz обошёл бы тест
  await mismatch([kzText, { ...goodQuiz, id: 'other-quiz' }]); // другой тест
  await mismatch([kzText, goodQuiz, { ...goodQuiz, id: 'extra' }]); // лишний тест
  // ничего из этого не записалось
  assert.equal(JSON.stringify((await getLessonForEdit(admin, courseId, lessonId))?.content), before);

  // тот же тест (копия из RU, тексты переведены) — сохраняется; пустая kz — тоже
  const kzQuiz = { ...goodQuiz, questions: goodQuiz.questions.map((q) => ({ ...q, text: `${q.text} (қаз)` })) };
  await save({ content: { ru: { v: 1, blocks: ru }, kz: { v: 1, blocks: [kzText, kzQuiz] } } });
  assert.equal((await getLessonForEdit(admin, courseId, lessonId))?.content.kz?.blocks.length, 2);
  await save({ content: { ru: { v: 1, blocks: ru }, kz: { v: 1, blocks: [] } } });
  assert.equal((await getLessonForEdit(admin, courseId, lessonId))?.content.kz, undefined);
});

test('зарезервированный адрес урока: certificate нельзя задать вручную, авто-slug получает суффикс', async () => {
  assert.deepEqual([...RESERVED_LESSON_SLUGS], ['certificate']);
  const e = await fails(save({ slug: 'certificate' }));
  assert.equal(e.fields?.slug, 'slugReserved');
  const e2 = await fails(save({ slug: 'Certificate' }));
  assert.equal(e2.fields?.slug, 'slugReserved');
  assert.notEqual((await getLessonForEdit(admin, courseId, lessonId))?.slug, 'certificate');

  const m = await addModule(admin, courseId, { titleRu: 'Итоги' });
  const auto = await addLesson(admin, m.id, { titleRu: 'Certificate' });
  assert.equal(auto.slug, 'certificate-2');
  // похожие адреса не зарезервированы
  const r = await save({ slug: 'certificate-review' });
  assert.equal(r.slug, 'certificate-review');
});

test('статус published требует контента; урок из чужого курса не находится', async () => {
  await fails(save({ status: 'published' }, []));
  await save({ status: 'published' }, [{ id: 't', type: 'text', markdown: 'x' }]);
  const l = await getLessonForEdit(admin, courseId, lessonId);
  assert.equal(l?.status, 'published');
  assert.equal(await getLessonForEdit(admin, 'другой-курс', lessonId), null);
  await assert.rejects(
    updateLesson(admin, 'другой-курс', lessonId, { titleRu: 'X', status: 'draft', content: { ru: { v: 1, blocks: [] } } }),
    (e: unknown) => e instanceof AdminError && e.code === 'NOT_FOUND',
  );
});

test('не администратор не редактирует и не читает урок', async () => {
  await assert.rejects(
    updateLesson(learner, courseId, lessonId, { titleRu: 'X', status: 'draft', content: { ru: { v: 1, blocks: [] } } }),
    (e: unknown) => e instanceof AdminError && e.code === 'FORBIDDEN',
  );
  await assert.rejects(
    getLessonForEdit(learner, courseId, lessonId),
    (e: unknown) => e instanceof AdminError && e.code === 'FORBIDDEN',
  );
});
