import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  addLesson,
  addModule,
  createCourse,
  deleteCourse,
  getCourse,
  listCourses,
  setCourseStatus,
  setLessonStatus,
  updateCourse,
  updateLesson,
  AdminError,
  slugify,
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

async function offerRows(courseId: string) {
  return db.sql<{ priceKzt: number; accessDays: number | null; active: boolean }>`
    SELECT price_kzt, access_days, active FROM course_offers WHERE course_id = ${courseId}`;
}

async function auditActions(): Promise<string[]> {
  const rows = await db.sql<{ action: string }>`SELECT action FROM audit_log ORDER BY created_at, id`;
  return rows.map((r) => r.action);
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('adm', 'adm@x.kz', 'Админ', 'admin', 1), ('lrn', 'lrn@x.kz', 'Слушатель', 'learner', 1)`;
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES ('org1', 'crp', 'ЦРП', 'owner', 1)`;
});
after(async () => {
  await db.close();
});

test('slugify: русский и казахский → латиница', () => {
  assert.equal(slugify('Целина: основы бизнеса'), 'tselina-osnovy-biznesa');
  assert.equal(slugify('Ә ғ қ ң ө ұ ү һ і'), 'a-g-k-n-o-u-u-h-i');
  assert.equal(slugify('Бизнес-разбор «Щука» №1'), 'biznes-razbor-shchuka-1');
  assert.equal(slugify('  Съезд, объём — ЁЖ  '), 'sezd-obyom-yozh');
  assert.equal(slugify('!!!'), '');
  assert.ok(slugify('а'.repeat(200)).length <= 60);
});

test('создание курса: slug из названия, черновик, без предложения при пустой цене', async () => {
  const { id, slug } = await createCourse(admin, { titleRu: 'Основы продаж', titleKz: 'Сатылым негіздері' });
  assert.equal(slug, 'osnovy-prodazh');
  const c = await getCourse(admin, id);
  assert.ok(c);
  assert.equal(c.status, 'draft');
  assert.equal(c.visibility, 'public');
  assert.deepEqual(c.title, { ru: 'Основы продаж', kz: 'Сатылым негіздері' });
  assert.equal(c.priceKzt, null);
  assert.deepEqual(await offerRows(id), []);
  assert.ok((await auditActions()).includes('course.create'));
});

test('повторное название получает суффикс, явный занятый slug — ошибка', async () => {
  const a = await createCourse(admin, { titleRu: 'Повтор' });
  const b = await createCourse(admin, { titleRu: 'Повтор' });
  assert.equal(a.slug, 'povtor');
  assert.equal(b.slug, 'povtor-2');
  const e = await rejects(createCourse(admin, { titleRu: 'Другой', slug: 'povtor' }), 'SLUG_TAKEN');
  assert.equal(e.fields?.slug, 'slugTaken');
});

test('валидация формы: название, формат slug, внутренний курс без организации, цена', async () => {
  let e = await rejects(createCourse(admin, { titleRu: '   ' }), 'VALIDATION');
  assert.equal(e.fields?.titleRu, 'required');
  e = await rejects(createCourse(admin, { titleRu: 'X', slug: 'Плохой slug!' }), 'VALIDATION');
  assert.equal(e.fields?.slug, 'slugFormat');
  e = await rejects(createCourse(admin, { titleRu: 'X', visibility: 'internal' }), 'VALIDATION');
  assert.equal(e.fields?.ownerOrgId, 'ownerRequired');
  e = await rejects(createCourse(admin, { titleRu: 'X', priceKzt: 'abc' }), 'VALIDATION');
  assert.equal(e.fields?.priceKzt, 'notNumber');
  e = await rejects(createCourse(admin, { titleRu: 'X', priceKzt: '-5' }), 'VALIDATION');
  assert.equal(e.fields?.priceKzt, 'tooSmall');
  e = await rejects(createCourse(admin, { titleRu: 'X', priceKzt: '1000', accessDays: '0' }), 'VALIDATION');
  assert.equal(e.fields?.accessDays, 'tooSmall');
  e = await rejects(createCourse(admin, { titleRu: 'X', visibility: 'internal', ownerOrgId: 'нет-такой' }), 'VALIDATION');
  assert.equal(e.fields?.ownerOrgId, 'invalid');
  e = await rejects(createCourse(admin, { titleRu: 'X', level: 'expert' }), 'VALIDATION');
  assert.equal(e.fields?.level, 'invalid');
});

test('цена → строка course_offers; 0 или пусто — предложения нет', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Платный', priceKzt: '99 000', accessDays: '365' });
  assert.deepEqual(await offerRows(id), [{ priceKzt: 99000, accessDays: 365, active: true }]);

  // смена цены обновляет ту же строку (UNIQUE course_id)
  await updateCourse(admin, id, { titleRu: 'Платный', priceKzt: 120000, accessDays: '' });
  assert.deepEqual(await offerRows(id), [{ priceKzt: 120000, accessDays: null, active: true }]);

  // 0 → свободный курс: активного предложения нет (и цены > 0 тоже, иначе self остался бы запрещён)
  await updateCourse(admin, id, { titleRu: 'Платный', priceKzt: 0 });
  assert.deepEqual(await offerRows(id), []);
  const c = await getCourse(admin, id);
  assert.equal(c?.priceKzt, null);

  // пустая строка — то же самое
  await updateCourse(admin, id, { titleRu: 'Платный', priceKzt: 5000 });
  assert.equal((await offerRows(id)).length, 1);
  await updateCourse(admin, id, { titleRu: 'Платный', priceKzt: '' });
  assert.deepEqual(await offerRows(id), []);
});

test('внутренний курс хранит организацию, публичный — нет', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Для своих', visibility: 'internal', ownerOrgId: 'org1' });
  assert.equal((await getCourse(admin, id))?.ownerOrgId, 'org1');
  await updateCourse(admin, id, { titleRu: 'Для своих', visibility: 'public', ownerOrgId: 'org1' });
  assert.equal((await getCourse(admin, id))?.ownerOrgId, null);
});

test('правка курса: slug уникален, смена и аудит изменённых полей', async () => {
  const a = await createCourse(admin, { titleRu: 'Курс А' });
  const b = await createCourse(admin, { titleRu: 'Курс Б' });
  const e = await rejects(updateCourse(admin, b.id, { titleRu: 'Курс Б', slug: a.slug }), 'SLUG_TAKEN');
  assert.equal(e.fields?.slug, 'slugTaken');
  const res = await updateCourse(admin, b.id, { titleRu: 'Курс Б (новый)', slug: 'kurs-b-new', durationMin: 90 });
  assert.equal(res.slug, 'kurs-b-new');
  // пустой slug при правке — не меняется
  const keep = await updateCourse(admin, b.id, { titleRu: 'Курс Б (новый)', durationMin: 90 });
  assert.equal(keep.slug, 'kurs-b-new');
  const [log] = await db.sql<{ meta: { changed: string[] } }>`
    SELECT meta FROM audit_log WHERE action = 'course.update' AND entity_id = ${b.id} ORDER BY created_at, id LIMIT 1`;
  assert.deepEqual(log?.meta.changed.sort(), ['durationMin', 'slug', 'title']);
  await rejects(updateCourse(admin, 'нет-такого', { titleRu: 'X' }), 'NOT_FOUND');
});

test('публикация курса требует опубликованного урока', async () => {
  const { id } = await createCourse(admin, { titleRu: 'К публикации' });
  // при создании опубликовать нельзя
  await rejects(createCourse(admin, { titleRu: 'Сразу', status: 'published' }), 'NO_PUBLISHED_LESSONS');
  await rejects(setCourseStatus(admin, id, 'published'), 'NO_PUBLISHED_LESSONS');
  const e = await rejects(updateCourse(admin, id, { titleRu: 'К публикации', status: 'published' }), 'NO_PUBLISHED_LESSONS');
  assert.equal(e.fields?.status, 'noPublishedLessons');

  const m = await addModule(admin, id, { titleRu: 'Модуль' });
  const l = await addLesson(admin, m.id, { titleRu: 'Урок' });
  // пустой урок опубликовать нельзя
  await rejects(setLessonStatus(admin, l.id, 'published'), 'LESSON_EMPTY');
  await updateLesson(admin, id, l.id, {
    titleRu: 'Урок',
    status: 'published',
    content: { ru: { v: 1, blocks: [{ id: 'b1', type: 'text', markdown: 'Привет' }] } },
  });
  await setCourseStatus(admin, id, 'published');
  assert.equal((await getCourse(admin, id))?.status, 'published');
  const actions = await auditActions();
  assert.ok(actions.includes('course.publish'));

  await setCourseStatus(admin, id, 'draft');
  assert.equal((await getCourse(admin, id))?.status, 'draft');
  assert.ok((await auditActions()).includes('course.unpublish'));
});

test('список курсов: счётчики уроков, цена, фильтры', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Для списка', priceKzt: 49000 });
  const m = await addModule(admin, id, { titleRu: 'М' });
  await addLesson(admin, m.id, { titleRu: 'У1' });
  await addLesson(admin, m.id, { titleRu: 'У2' });
  const all = await listCourses(admin);
  const row = all.find((c) => c.id === id);
  assert.ok(row);
  assert.equal(row.lessonsTotal, 2);
  assert.equal(row.lessonsPublished, 0);
  assert.equal(row.priceKzt, 49000);
  assert.equal(row.enrollmentsActive, 0);
  assert.ok((await listCourses(admin, { status: 'published' })).every((c) => c.status === 'published'));
  assert.deepEqual((await listCourses(admin, { q: 'Для спис' })).map((c) => c.id), [id]);
  // подстановочные символы ищутся буквально
  assert.deepEqual(await listCourses(admin, { q: '%' }), []);
});

test('удаление курса: только без заказов, зачислений и сертификатов', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Удаляемый', priceKzt: 1000 });
  await db.sql`INSERT INTO enrollments (id, user_id, course_id, source, created_at, updated_at)
    VALUES ('en1', 'lrn', ${id}, 'grant', 1, 1)`;
  await rejects(deleteCourse(admin, id), 'COURSE_HAS_DATA');
  await db.sql`DELETE FROM enrollments WHERE id = 'en1'`;
  await deleteCourse(admin, id);
  assert.equal(await getCourse(admin, id), null);
  assert.deepEqual(await offerRows(id), []);
  assert.ok((await auditActions()).includes('course.delete'));
  await rejects(deleteCourse(admin, id), 'NOT_FOUND');
});

test('не администратор отклоняется на уровне функций', async () => {
  const { id } = await createCourse(admin, { titleRu: 'Защищённый' });
  await rejects(createCourse(learner, { titleRu: 'Взлом' }), 'FORBIDDEN');
  await rejects(updateCourse(learner, id, { titleRu: 'Взлом' }), 'FORBIDDEN');
  await rejects(setCourseStatus(learner, id, 'published'), 'FORBIDDEN');
  await rejects(deleteCourse(learner, id), 'FORBIDDEN');
  await rejects(listCourses(learner), 'FORBIDDEN');
  await rejects(getCourse(learner, id), 'FORBIDDEN');
  // подделка роли в объекте актора не помогает: роль сверяется с БД
  await rejects(createCourse({ id: 'lrn', role: 'admin' }, { titleRu: 'Взлом' }), 'FORBIDDEN');
  await rejects(createCourse({ id: 'нет-такого', role: 'admin' }, { titleRu: 'Взлом' }), 'FORBIDDEN');
  await rejects(createCourse(null as never, { titleRu: 'Взлом' }), 'FORBIDDEN');
});
