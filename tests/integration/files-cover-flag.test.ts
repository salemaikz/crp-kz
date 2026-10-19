// K-8: при неактивной загрузке файлов обложка /api/files/<uuid> не отдаётся ни каталогом, ни обучением
// (иначе витрина показала бы сломанную картинку: маршрут вернёт 404).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { enroll } from '../../src/lib/access';
import { getCourseDetail, listCatalogCourses, listFeaturedCourses } from '../../src/lib/catalog/queries';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { getCourse, listLearnerCourses } from '../../src/lib/learn/data';

const COVER = '/api/files/0b6d3f52-8f0e-4c3a-9d36-6f0b8c1a2e11';
let db: TestDb;
let saved: string | undefined;

before(async () => {
  saved = process.env.FEATURE_UPLOADS;
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'u1@x.kz', 'Слушатель', 1)`;
  await db.sql`
    INSERT INTO courses (id, slug, title, summary, description, cover, level, duration_min, visibility, status,
                         position, created_at, updated_at)
    VALUES ('c1', 'cover-course', ${db.json({ ru: 'Курс' })}, ${db.json({ ru: 'О курсе' })},
            ${db.json({ ru: 'Описание' })}, ${COVER}, 'base', 60, 'public', 'published', 0, 1, 1)`;
  await enroll({ userId: 'u1', courseId: 'c1', source: 'grant' });
});
after(async () => {
  if (saved === undefined) delete process.env.FEATURE_UPLOADS;
  else process.env.FEATURE_UPLOADS = saved;
  await db.close();
});

async function covers(): Promise<Record<string, string | null | undefined>> {
  const catalog = (await listCatalogCourses([])).find((c) => c.slug === 'cover-course');
  const detail = await getCourseDetail('cover-course', []);
  const featured = (await listFeaturedCourses(10)).find((c) => c.slug === 'cover-course');
  const bySlug = await getCourse({ slug: 'cover-course' });
  const byId = await getCourse({ id: 'c1' });
  const learner = (await listLearnerCourses('u1')).find((l) => l.course.id === 'c1');
  return {
    catalog: catalog?.cover,
    detail: detail?.cover,
    featured: featured?.cover,
    bySlug: bySlug?.cover,
    byId: byId?.cover,
    learner: learner?.course.cover,
  };
}

test('FEATURE_UPLOADS=0: обложка из /api/files/ — null везде', async () => {
  process.env.FEATURE_UPLOADS = '0';
  const c = await covers();
  for (const [where, cover] of Object.entries(c)) assert.equal(cover, null, where);
});

test('FEATURE_UPLOADS=1: адрес отдаётся везде', async () => {
  process.env.FEATURE_UPLOADS = '1';
  const c = await covers();
  for (const [where, cover] of Object.entries(c)) assert.equal(cover, COVER, where);
});
