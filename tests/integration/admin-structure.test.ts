import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  AdminError,
  addLesson,
  addModule,
  createCourse,
  deleteLesson,
  deleteModule,
  getCourseStructure,
  moveLesson,
  moveModule,
  renameModule,
  setLessonStatus,
  updateLesson,
} from '../../src/lib/admin';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;
const admin = { id: 'adm', role: 'admin' };
const learner = { id: 'lrn', role: 'learner' };

async function rejects(p: Promise<unknown>, code: string): Promise<AdminError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof AdminError, `ожидалась AdminError, получено ${String(e)}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`ожидалась ошибка ${code}`);
}

/** Порядок «Модуль: уроки» одной строкой — для компактных проверок. */
async function shape(courseId: string): Promise<string> {
  const tree = await getCourseStructure(admin, courseId);
  return tree.map((m) => `${m.title.ru}:${m.lessons.map((l) => l.title.ru).join(',')}`).join(' | ');
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('adm', 'adm@x.kz', 'Админ', 'admin', 1), ('lrn', 'lrn@x.kz', 'Слушатель', 'learner', 1)`;
});
after(async () => {
  await db.close();
});

test('модули: добавление идёт в конец, порядок сквозной, kz-название необязательно', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Программа' });
  const a = await addModule(admin, id, { titleRu: 'A', titleKz: 'А-kz' });
  await addModule(admin, id, { titleRu: 'B' });
  await addModule(admin, id, { titleRu: 'C' });
  assert.equal(await shape(id), 'A: | B: | C:');
  const tree = await getCourseStructure(admin, id);
  assert.deepEqual(tree.map((m) => m.position), [0, 1, 2]);
  assert.deepEqual(tree[0]?.title, { ru: 'A', kz: 'А-kz' });
  assert.deepEqual(tree[1]?.title, { ru: 'B' });
  await rejects(addModule(admin, id, { titleRu: '  ' }), 'VALIDATION');
  await rejects(addModule(admin, 'нет-такого', { titleRu: 'X' }), 'NOT_FOUND');
  await renameModule(admin, a.id, { titleRu: 'A2', titleKz: '' });
  assert.deepEqual((await getCourseStructure(admin, id))[0]?.title, { ru: 'A2' });
});

test('модули: вверх/вниз, границы ничего не делают', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Порядок модулей' });
  const [a, b, c] = [
    await addModule(admin, id, { titleRu: 'A' }),
    await addModule(admin, id, { titleRu: 'B' }),
    await addModule(admin, id, { titleRu: 'C' }),
  ];
  assert.equal(await moveModule(admin, c.id, 'up'), true);
  assert.equal(await shape(id), 'A: | C: | B:');
  assert.equal(await moveModule(admin, a.id, 'up'), false); // уже первый
  assert.equal(await moveModule(admin, b.id, 'down'), false); // уже последний
  assert.equal(await moveModule(admin, a.id, 'down'), true);
  assert.equal(await shape(id), 'C: | A: | B:');
  assert.deepEqual((await getCourseStructure(admin, id)).map((m) => m.position), [0, 1, 2]);
  await rejects(moveModule(admin, a.id, 'sideways'), 'VALIDATION');
});

test('модули: удалить можно только пустой', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Удаление модулей' });
  const m1 = await addModule(admin, id, { titleRu: 'Занятый' });
  const m2 = await addModule(admin, id, { titleRu: 'Пустой' });
  await addLesson(admin, m1.id, { titleRu: 'Урок' });
  await rejects(deleteModule(admin, m1.id), 'MODULE_NOT_EMPTY');
  await deleteModule(admin, m2.id);
  assert.equal(await shape(id), 'Занятый:Урок');
  await rejects(deleteModule(admin, m2.id), 'NOT_FOUND');
});

test('уроки: slug из названия, уникален в курсе, порядок и перенос между модулями', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Порядок уроков' });
  const m1 = await addModule(admin, id, { titleRu: 'M1' });
  const m2 = await addModule(admin, id, { titleRu: 'M2' });
  const l1 = await addLesson(admin, m1.id, { titleRu: 'Урок', durationMin: '15' });
  const l2 = await addLesson(admin, m1.id, { titleRu: 'Урок' });
  const l3 = await addLesson(admin, m2.id, { titleRu: 'Третий' });
  assert.equal(l1.slug, 'urok');
  assert.equal(l2.slug, 'urok-2');
  assert.equal(l1.courseId, id);
  assert.equal(await shape(id), 'M1:Урок,Урок | M2:Третий');

  // внутри модуля
  assert.equal(await moveLesson(admin, l2.id, 'up'), true);
  const tree = await getCourseStructure(admin, id);
  assert.deepEqual(tree[0]?.lessons.map((l) => l.slug), ['urok-2', 'urok']);
  assert.equal(tree[0]?.lessons[1]?.durationMin, 15);

  // первый урок модуля 2 «вверх» уходит в конец модуля 1
  assert.equal(await moveLesson(admin, l3.id, 'up'), true);
  assert.deepEqual((await getCourseStructure(admin, id)).map((m) => m.lessons.map((l) => l.slug)), [
    ['urok-2', 'urok', 'tretiy'],
    [],
  ]);
  // и обратно «вниз» — в начало следующего
  assert.equal(await moveLesson(admin, l3.id, 'down'), true);
  assert.deepEqual((await getCourseStructure(admin, id)).map((m) => m.lessons.map((l) => l.slug)), [
    ['urok-2', 'urok'],
    ['tretiy'],
  ]);
  // границы курса
  assert.equal(await moveLesson(admin, l3.id, 'down'), false);
  assert.equal(await moveLesson(admin, l2.id, 'up'), false);

  // позиции в каждом модуле — 0..n-1, а модуль урока из того же курса (составной FK цел)
  const rows = await db.sql<{ moduleId: string; position: number }>`
    SELECT module_id, position FROM lessons WHERE course_id = ${id} ORDER BY module_id, position`;
  assert.deepEqual(rows.filter((r) => r.moduleId === m1.id).map((r) => r.position), [0, 1]);
  assert.deepEqual(rows.filter((r) => r.moduleId === m2.id).map((r) => r.position), [0]);
});

test('уроки: публикация, пустой урок не публикуется, удаление с прогрессом запрещено', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Публикация уроков' });
  const m = await addModule(admin, id, { titleRu: 'M' });
  const l = await addLesson(admin, m.id, { titleRu: 'Первый' });
  const [fresh] = (await getCourseStructure(admin, id))[0]?.lessons ?? [];
  assert.equal(fresh?.status, 'draft');
  assert.equal(fresh?.blocksRu, 0);
  assert.equal(fresh?.hasKz, false);

  await rejects(setLessonStatus(admin, l.id, 'published'), 'LESSON_EMPTY');
  await updateLesson(admin, id, l.id, {
    titleRu: 'Первый',
    content: { ru: { v: 1, blocks: [{ id: 'b', type: 'text', markdown: 'x' }] } },
  });
  await setLessonStatus(admin, l.id, 'published');
  assert.equal((await getCourseStructure(admin, id))[0]?.lessons[0]?.status, 'published');
  await setLessonStatus(admin, l.id, 'draft');
  assert.equal((await getCourseStructure(admin, id))[0]?.lessons[0]?.status, 'draft');

  // прогресс слушателя защищает урок от удаления
  await db.sql`INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at)
    VALUES ('lrn', ${l.id}, ${id}, 1)`;
  await rejects(deleteLesson(admin, l.id), 'LESSON_HAS_PROGRESS');
  await db.sql`DELETE FROM lesson_progress WHERE lesson_id = ${l.id}`;
  await deleteLesson(admin, l.id);
  assert.equal(await shape(id), 'M:');
  await rejects(deleteLesson(admin, l.id), 'NOT_FOUND');
});

test('аудит: каждое изменение структуры пишется в audit_log', async () => {
  const rows = await db.sql<{ action: string }>`SELECT DISTINCT action FROM audit_log ORDER BY action`;
  const actions = rows.map((r) => r.action);
  for (const a of [
    'course.create',
    'module.create',
    'module.rename',
    'module.move',
    'module.delete',
    'lesson.create',
    'lesson.move',
    'lesson.update',
    'lesson.publish',
    'lesson.unpublish',
    'lesson.delete',
  ]) {
    assert.ok(actions.includes(a), `нет записи ${a}`);
  }
  const [row] = await db.sql<{ actorId: string }>`SELECT actor_id FROM audit_log WHERE action = 'lesson.delete'`;
  assert.equal(row?.actorId, 'adm');
});

test('не администратор не меняет структуру', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Чужой курс' });
  const m = await addModule(admin, id, { titleRu: 'M' });
  const l = await addLesson(admin, m.id, { titleRu: 'L' });
  await rejects(addModule(learner, id, { titleRu: 'X' }), 'FORBIDDEN');
  await rejects(renameModule(learner, m.id, { titleRu: 'X' }), 'FORBIDDEN');
  await rejects(moveModule(learner, m.id, 'down'), 'FORBIDDEN');
  await rejects(deleteModule(learner, m.id), 'FORBIDDEN');
  await rejects(addLesson(learner, m.id, { titleRu: 'X' }), 'FORBIDDEN');
  await rejects(moveLesson(learner, l.id, 'up'), 'FORBIDDEN');
  await rejects(deleteLesson(learner, l.id), 'FORBIDDEN');
  await rejects(setLessonStatus(learner, l.id, 'published'), 'FORBIDDEN');
  await rejects(getCourseStructure(learner, id), 'FORBIDDEN');
  assert.equal(await shape(id), 'M:L');
});
