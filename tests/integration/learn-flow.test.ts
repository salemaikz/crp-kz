// Обучение: доступ, замки последовательного курса, тесты и завершение уроков (PGlite, без внешней БД).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { enroll, revokeEnrollment } from '../../src/lib/access';
import type { Block } from '../../src/lib/content/types';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { LearnError, type LearnErrorCode } from '../../src/lib/learn/errors';
import { loadCourseAccess } from '../../src/lib/learn/gate';
import { completeLesson } from '../../src/lib/learn/progress';
import { getQuizStatuses, submitQuiz } from '../../src/lib/learn/quiz';

let db: TestDb;

const PASS = [[1], [0, 2], [0]];
const FAIL = [[0], [1], [1]];
const HALF = [[1], [0, 2], [1]]; // 2 из 3 = 67 %

const quiz = (id = 'quiz', passScore = 60): Block => ({
  id,
  type: 'quiz',
  passScore,
  questions: [
    { id: 'q1', text: 'Один ответ', options: ['a', 'b', 'c'], correct: [1], multiple: false, explain: 'Потому что b' },
    { id: 'q2', text: 'Несколько', options: ['a', 'b', 'c'], correct: [0, 2], multiple: true },
    { id: 'q3', text: 'Да или нет', options: ['да', 'нет'], correct: [0], multiple: false, explain: 'Да' },
  ],
});
const text = (id = 't'): Block => ({ id, type: 'text', markdown: 'Текст' });

type LessonSeed = {
  id: string;
  course: string;
  module: string;
  pos: number;
  status?: 'published' | 'draft';
  ru: Block[];
  kz?: Block[];
};

async function addCourse(id: string, o: { status?: string; visibility?: string; sequential?: boolean; owner?: string | null } = {}) {
  await db.sql`
    INSERT INTO courses (id, slug, title, visibility, owner_org_id, status, sequential, created_at, updated_at)
    VALUES (${id}, ${id}, ${db.json({ ru: `Курс ${id}`, kz: `Курс ${id} (қаз)` })}, ${o.visibility ?? 'public'}, ${o.owner ?? null},
            ${o.status ?? 'published'}, ${o.sequential ?? false}, 1, 1)`;
}
async function addModule(id: string, course: string, pos: number) {
  await db.sql`INSERT INTO course_modules (id, course_id, position, title, created_at)
               VALUES (${id}, ${course}, ${pos}, ${db.json({ ru: `Модуль ${id}` })}, 1)`;
}
async function addLesson(l: LessonSeed) {
  const content = l.kz ? { ru: { v: 1, blocks: l.ru }, kz: { v: 1, blocks: l.kz } } : { ru: { v: 1, blocks: l.ru } };
  await db.sql`
    INSERT INTO lessons (id, course_id, module_id, position, slug, title, content, duration_min, status, created_at, updated_at)
    VALUES (${l.id}, ${l.course}, ${l.module}, ${l.pos}, ${l.id}, ${db.json({ ru: `Урок ${l.id}` })}, ${db.json(content)},
            10, ${l.status ?? 'published'}, 1, 1)`;
}

/** Ожидаем LearnError с кодом. */
async function refuses(code: LearnErrorCode, p: Promise<unknown>) {
  await assert.rejects(p, (e) => e instanceof LearnError && e.code === code, `ожидался отказ ${code}`);
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES ('org', 'org', 'Орг', 'owner', 1)`;
  for (const u of ['u1', 'u2', 'u3', 'u4']) {
    await db.sql`INSERT INTO users (id, email, name, created_at) VALUES (${u}, ${u + '@x.kz'}, ${'Пользователь ' + u}, 1)`;
  }

  // свободный курс: l1 без теста, l2 с тестом, l3 с тестом только в ru, l4 — черновик
  await addCourse('free');
  await addModule('free-m1', 'free', 0);
  await addModule('free-m2', 'free', 1);
  await addLesson({ id: 'f1', course: 'free', module: 'free-m1', pos: 0, ru: [text()] });
  await addLesson({ id: 'f2', course: 'free', module: 'free-m1', pos: 1, ru: [text(), quiz()] });
  await addLesson({ id: 'f3', course: 'free', module: 'free-m2', pos: 0, ru: [text(), quiz()], kz: [text()] });
  await addLesson({ id: 'f4', course: 'free', module: 'free-m2', pos: 1, status: 'draft', ru: [text()] });
  // тот же id теста в обеих локалях
  await addLesson({ id: 'f5', course: 'free', module: 'free-m2', pos: 2, ru: [quiz('quiz')], kz: [quiz('quiz')] });
  // два теста в одном уроке
  await addLesson({ id: 'f6', course: 'free', module: 'free-m2', pos: 3, ru: [quiz('quizA'), text('mid'), quiz('quizB')] });

  // последовательный курс
  await addCourse('seq', { sequential: true });
  await addModule('seq-m1', 'seq', 0);
  await addModule('seq-m2', 'seq', 1);
  await addLesson({ id: 's1', course: 'seq', module: 'seq-m1', pos: 0, ru: [text()] });
  await addLesson({ id: 's2', course: 'seq', module: 'seq-m1', pos: 1, ru: [text(), quiz()] });
  await addLesson({ id: 's3', course: 'seq', module: 'seq-m2', pos: 0, ru: [text()] });

  // черновик и закрытый курс
  await addCourse('draft', { status: 'draft' });
  await addModule('draft-m1', 'draft', 0);
  await addLesson({ id: 'd1', course: 'draft', module: 'draft-m1', pos: 0, ru: [text()] });
  await addCourse('internal', { visibility: 'internal', owner: 'org' });
  await addModule('int-m1', 'internal', 0);
  await addLesson({ id: 'i1', course: 'internal', module: 'int-m1', pos: 0, ru: [text()] });
});
after(async () => {
  await db.close();
});

// ---------- доступ ----------

test('нет зачисления: курс виден как «нет доступа», тест и «пройден» отказывают', async () => {
  const a = await loadCourseAccess('u1', { slug: 'free' });
  assert.equal(a.status, 'denied');
  assert.equal(a.status === 'denied' && a.reason, 'none');
  await refuses('forbidden', completeLesson({ userId: 'u1', lessonId: 'f1', locale: 'ru' }));
  await refuses('forbidden', submitQuiz({ userId: 'u1', lessonId: 'f2', blockId: 'quiz', answers: PASS, locale: 'ru' }));
  const rows = await db.sql`SELECT 1 FROM lesson_progress WHERE user_id = 'u1'`;
  assert.equal(rows.length, 0);
  const attempts = await db.sql`SELECT 1 FROM quiz_attempts WHERE user_id = 'u1'`;
  assert.equal(attempts.length, 0);
});

test('черновик курса и несуществующий курс — not_found; чужой internal не раскрывается', async () => {
  await enroll({ userId: 'u1', courseId: 'draft', source: 'grant' });
  assert.equal((await loadCourseAccess('u1', { slug: 'draft' })).status, 'not_found');
  assert.equal((await loadCourseAccess('u1', { slug: 'нет-такого' })).status, 'not_found');
  assert.equal((await loadCourseAccess('u2', { slug: 'internal' })).status, 'not_found');
  await refuses('not_found', completeLesson({ userId: 'u1', lessonId: 'd1', locale: 'ru' }));
  await refuses('not_found', completeLesson({ userId: 'u1', lessonId: 'нет-урока', locale: 'ru' }));
});

test('черновик урока слушателю не виден и не засчитывается', async () => {
  await enroll({ userId: 'u2', courseId: 'free', source: 'grant' });
  await refuses('not_found', completeLesson({ userId: 'u2', lessonId: 'f4', locale: 'ru' }));
  const a = await loadCourseAccess('u2', { slug: 'free' });
  assert.ok(a.status === 'ok');
  assert.deepEqual(
    a.progress.lessons.map((l) => l.id),
    ['f1', 'f2', 'f3', 'f5', 'f6'],
  );
});

test('отозванный и истёкший доступ закрывают уроки; прогресс сохраняется', async () => {
  await enroll({ userId: 'u3', courseId: 'free', source: 'grant' });
  await completeLesson({ userId: 'u3', lessonId: 'f1', locale: 'ru' });

  await revokeEnrollment('u3', 'free', null);
  const revoked = await loadCourseAccess('u3', { slug: 'free' });
  assert.ok(revoked.status === 'denied' && revoked.reason === 'revoked');
  await refuses('forbidden', completeLesson({ userId: 'u3', lessonId: 'f3', locale: 'ru' }));
  await refuses('forbidden', submitQuiz({ userId: 'u3', lessonId: 'f2', blockId: 'quiz', answers: PASS, locale: 'ru' }));

  // возврат доступа: прогресс на месте
  await enroll({ userId: 'u3', courseId: 'free', source: 'grant' });
  const back = await loadCourseAccess('u3', { slug: 'free' });
  assert.ok(back.status === 'ok' && back.progress.done === 1);

  await db.sql`UPDATE enrollments SET expires_at = ${Date.now() - 1000} WHERE user_id = 'u3' AND course_id = 'free'`;
  const expired = await loadCourseAccess('u3', { slug: 'free' });
  assert.ok(expired.status === 'denied' && expired.reason === 'expired');
  await refuses('forbidden', completeLesson({ userId: 'u3', lessonId: 'f3', locale: 'ru' }));
});

// ---------- тесты и завершение ----------

test('урок без теста завершается и идемпотентен', async () => {
  await enroll({ userId: 'u4', courseId: 'free', source: 'self' });
  const first = await completeLesson({ userId: 'u4', lessonId: 'f1', locale: 'ru' });
  assert.equal(first.alreadyCompleted, false);
  assert.deepEqual([first.done, first.total, first.pct, first.courseComplete], [1, 5, 20, false]);
  assert.equal(first.next?.slug, 'f2');
  const again = await completeLesson({ userId: 'u4', lessonId: 'f1', locale: 'ru' });
  assert.equal(again.alreadyCompleted, true);
  assert.equal(again.done, 1);
  const rows = await db.sql`SELECT 1 FROM lesson_progress WHERE user_id = 'u4' AND lesson_id = 'f1'`;
  assert.equal(rows.length, 1);
});

test('параллельные «пройден» не создают дублей', async () => {
  await enroll({ userId: 'u2', courseId: 'seq', source: 'grant' });
  const all = await Promise.all(
    Array.from({ length: 5 }, () => completeLesson({ userId: 'u2', lessonId: 's1', locale: 'ru' })),
  );
  assert.equal(all.filter((r) => !r.alreadyCompleted).length <= 1, true);
  const rows = await db.sql`SELECT 1 FROM lesson_progress WHERE user_id = 'u2' AND lesson_id = 's1'`;
  assert.equal(rows.length, 1);
});

test('нельзя завершить урок с тестом без сданного теста; проваленная попытка не помогает', async () => {
  await refuses('quiz_required', completeLesson({ userId: 'u4', lessonId: 'f2', locale: 'ru' }));

  const fail = await submitQuiz({ userId: 'u4', lessonId: 'f2', blockId: 'quiz', answers: FAIL, locale: 'ru' });
  // провал — только счёт: ни разбора по вопросам, ни пояснений (D-020)
  assert.deepEqual(fail, { passed: false, correct: 0, total: 3, scorePct: 0 });
  assert.equal(JSON.stringify(fail).includes('Потому что'), false);
  await refuses('quiz_required', completeLesson({ userId: 'u4', lessonId: 'f2', locale: 'ru' }));

  const pass = await submitQuiz({ userId: 'u4', lessonId: 'f2', blockId: 'quiz', answers: PASS, locale: 'ru' });
  assert.deepEqual([pass.correct, pass.scorePct, pass.passed], [3, 100, true]);
  const done = await completeLesson({ userId: 'u4', lessonId: 'f2', locale: 'ru' });
  assert.equal(done.done, 2);
});

test('попытки сохраняются как есть; разбор и пояснения — только в ответе на сданную попытку', async () => {
  const rows = await db.sql<{ blockId: string; correct: number; total: number; passed: boolean }>`
    SELECT block_id, correct, total, passed FROM quiz_attempts
    WHERE user_id = 'u4' AND lesson_id = 'f2' ORDER BY created_at, id`;
  assert.deepEqual(
    rows.map((r) => [r.blockId, r.correct, r.total, r.passed]).sort(),
    [
      ['quiz', 0, 3, false],
      ['quiz', 3, 3, true],
    ].sort(),
  );
  const half = await submitQuiz({ userId: 'u4', lessonId: 'f2', blockId: 'quiz', answers: HALF, locale: 'ru' });
  assert.ok(half.passed);
  assert.deepEqual([half.correct, half.scorePct, half.passed, half.passScore], [2, 67, true, 60]);
  assert.equal(half.perQuestion[0]?.explain, 'Потому что b');
  assert.equal(half.perQuestion[2]?.correct, false);
  assert.equal(half.perQuestion[1] && 'explain' in half.perQuestion[1], false);

  const st = await getQuizStatuses('u4', 'f2');
  assert.deepEqual(st.get('quiz'), { attempts: 3, passed: true, bestPct: 100 });
});

test('кривые ответы и чужой блок отклоняются', async () => {
  await refuses('invalid', submitQuiz({ userId: 'u4', lessonId: 'f2', blockId: 'quiz', answers: [[1]], locale: 'ru' }));
  await refuses('invalid', submitQuiz({ userId: 'u4', lessonId: 'f2', blockId: 'quiz', answers: [[0, 1], [0], [0]], locale: 'ru' }));
  await refuses('invalid', submitQuiz({ userId: 'u4', lessonId: 'f2', blockId: 'quiz', answers: [[9], [0], [0]], locale: 'ru' }));
  await refuses('not_found', submitQuiz({ userId: 'u4', lessonId: 'f2', blockId: 'нет-такого', answers: PASS, locale: 'ru' }));
  await refuses('not_found', submitQuiz({ userId: 'u4', lessonId: 'f1', blockId: 'quiz', answers: PASS, locale: 'ru' })); // в уроке нет теста
});

test('несколько тестов в одном уроке учитываются раздельно', async () => {
  await refuses('quiz_required', completeLesson({ userId: 'u4', lessonId: 'f6', locale: 'ru' }));
  await submitQuiz({ userId: 'u4', lessonId: 'f6', blockId: 'quizA', answers: PASS, locale: 'ru' });
  await assert.rejects(
    completeLesson({ userId: 'u4', lessonId: 'f6', locale: 'ru' }),
    (e) => e instanceof LearnError && e.code === 'quiz_required' && JSON.stringify(e.detail) === '{"missing":["quizB"]}',
  );
  await submitQuiz({ userId: 'u4', lessonId: 'f6', blockId: 'quizB', answers: PASS, locale: 'ru' });
  assert.equal((await completeLesson({ userId: 'u4', lessonId: 'f6', locale: 'ru' })).alreadyCompleted, false);
});

// ---------- локали ----------

test('kz-документ без теста из ru не показывается: в kz тот же обязательный тест, обойти локалью нельзя', async () => {
  await enroll({ userId: 'u1', courseId: 'free', source: 'self' });
  await refuses('quiz_required', completeLesson({ userId: 'u1', lessonId: 'f3', locale: 'ru' }));
  // перевод без теста → показывается ru (fallback), его тест обязателен и в kz
  await refuses('quiz_required', completeLesson({ userId: 'u1', lessonId: 'f3', locale: 'kz' }));
  const fail = await submitQuiz({ userId: 'u1', lessonId: 'f3', blockId: 'quiz', answers: FAIL, locale: 'kz' });
  assert.equal(fail.passed, false);
  await refuses('quiz_required', completeLesson({ userId: 'u1', lessonId: 'f3', locale: 'kz' }));
  await submitQuiz({ userId: 'u1', lessonId: 'f3', blockId: 'quiz', answers: PASS, locale: 'kz' });
  const keys = await db.sql<{ blockId: string }>`
    SELECT DISTINCT block_id FROM quiz_attempts WHERE user_id = 'u1' AND lesson_id = 'f3'`;
  assert.deepEqual(keys.map((k) => k.blockId), ['quiz']); // засчитан как тест ru-документа
  const r = await completeLesson({ userId: 'u1', lessonId: 'f3', locale: 'kz' });
  assert.equal(r.alreadyCompleted, false);
});

test('kz-документ с другим тестом (не тем id, что в ru) тоже не показывается: требуется тест ru', async () => {
  await addLesson({ id: 'f7', course: 'free', module: 'free-m2', pos: 4, ru: [text(), quiz('quiz')], kz: [text(), quiz('kz-only')] });
  await refuses('quiz_required', completeLesson({ userId: 'u1', lessonId: 'f7', locale: 'kz' }));
  // тест kz-документа недоступен: показан ru
  await refuses('not_found', submitQuiz({ userId: 'u1', lessonId: 'f7', blockId: 'kz-only', answers: PASS, locale: 'kz' }));
  await submitQuiz({ userId: 'u1', lessonId: 'f7', blockId: 'quiz', answers: PASS, locale: 'kz' });
  assert.equal((await completeLesson({ userId: 'u1', lessonId: 'f7', locale: 'kz' })).alreadyCompleted, false);
});

test('перевода нет: в kz показан запасной ru-документ, его тест обязателен и сдаётся как русский', async () => {
  await refuses('quiz_required', completeLesson({ userId: 'u1', lessonId: 'f2', locale: 'kz' }));
  await submitQuiz({ userId: 'u1', lessonId: 'f2', blockId: 'quiz', answers: PASS, locale: 'kz' });
  const keys = await db.sql<{ blockId: string }>`SELECT block_id FROM quiz_attempts WHERE user_id = 'u1' AND lesson_id = 'f2'`;
  assert.deepEqual(keys.map((k) => k.blockId), ['quiz']);
  assert.equal((await completeLesson({ userId: 'u1', lessonId: 'f2', locale: 'kz' })).alreadyCompleted, false);
});

test('одинаковый id теста в ru и kz документах: сдача в одной локали не засчитывается в другой', async () => {
  await submitQuiz({ userId: 'u1', lessonId: 'f5', blockId: 'quiz', answers: PASS, locale: 'ru' });
  await refuses('quiz_required', completeLesson({ userId: 'u1', lessonId: 'f5', locale: 'kz' }));
  await submitQuiz({ userId: 'u1', lessonId: 'f5', blockId: 'quiz', answers: PASS, locale: 'kz' });
  const keys = await db.sql<{ blockId: string }>`
    SELECT block_id FROM quiz_attempts WHERE user_id = 'u1' AND lesson_id = 'f5' ORDER BY block_id`;
  assert.deepEqual(keys.map((k) => k.blockId), ['kz:quiz', 'quiz']);
  assert.equal((await completeLesson({ userId: 'u1', lessonId: 'f5', locale: 'kz' })).alreadyCompleted, false);
});

// ---------- последовательный курс ----------

test('последовательный курс: закрытые уроки отказывают на сервере (тест и «пройден»)', async () => {
  await enroll({ userId: 'u3', courseId: 'seq', source: 'grant' });
  const a = await loadCourseAccess('u3', { slug: 'seq' });
  assert.ok(a.status === 'ok');
  assert.deepEqual(
    a.progress.lessons.map((l) => `${l.id}:${l.state}`),
    ['s1:open', 's2:locked', 's3:locked'],
  );
  await refuses('locked', completeLesson({ userId: 'u3', lessonId: 's2', locale: 'ru' }));
  await refuses('locked', completeLesson({ userId: 'u3', lessonId: 's3', locale: 'ru' }));
  await refuses('locked', submitQuiz({ userId: 'u3', lessonId: 's2', blockId: 'quiz', answers: PASS, locale: 'ru' }));
  const attempts = await db.sql`SELECT 1 FROM quiz_attempts WHERE user_id = 'u3' AND lesson_id = 's2'`;
  assert.equal(attempts.length, 0);

  const r1 = await completeLesson({ userId: 'u3', lessonId: 's1', locale: 'ru' });
  assert.equal(r1.next?.slug, 's2'); // следующий открылся
  await refuses('locked', completeLesson({ userId: 'u3', lessonId: 's3', locale: 'ru' }));

  await submitQuiz({ userId: 'u3', lessonId: 's2', blockId: 'quiz', answers: PASS, locale: 'ru' });
  await completeLesson({ userId: 'u3', lessonId: 's2', locale: 'ru' });
  const r3 = await completeLesson({ userId: 'u3', lessonId: 's3', locale: 'ru' });
  assert.deepEqual([r3.pct, r3.courseComplete, r3.next], [100, true, null]);
});

test('прогресс считает только опубликованные уроки: снятие урока с публикации меняет итог', async () => {
  const before = await loadCourseAccess('u3', { slug: 'seq' });
  assert.ok(before.status === 'ok' && before.progress.complete);
  await db.sql`UPDATE lessons SET status = 'draft' WHERE id = 's3'`;
  const after = await loadCourseAccess('u3', { slug: 'seq' });
  assert.ok(after.status === 'ok');
  assert.deepEqual([after.progress.done, after.progress.total, after.progress.complete], [2, 2, true]);
  await db.sql`UPDATE lessons SET status = 'published' WHERE id = 's3'`;
});
