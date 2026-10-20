// Админские операции с файлами: обложка, удаление, список, занятое место, флаг.
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { AdminError, updateLesson } from '../../src/lib/admin';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { clearCourseCover, deleteFile, listCourseFiles, setCourseCover, storageUsage } from '../../src/lib/files/admin';
import {
  admin,
  learner,
  makeCourse,
  makeStorageDir,
  pdf,
  png,
  seedUsers,
  setEnv,
  upload,
  type TestCourse,
} from '../helpers/fileFixtures';

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;
let c: TestCourse;
let foreign: TestCourse;

before(async () => {
  storage = await makeStorageDir();
  restore = setEnv({ FEATURE_UPLOADS: '1', STORAGE_DIR: storage.dir });
  db = await createTestDb();
  await seedUsers(db);
  c = await makeCourse(db);
  foreign = await makeCourse(db);
});
after(async () => {
  restore();
  await db.close();
  await storage.cleanup();
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof AdminError, String(e));
    return e.code;
  }
  assert.fail('ожидалась AdminError');
}

const cover = (course: TestCourse) => upload(png(1200, 675), { purpose: 'course_cover', courseId: course.courseId });
const exists = (key: string) => access(path.join(storage.dir, 'objects', key)).then(() => true, () => false);

test('setCourseCover пишет cover и cover_file_id вместе, журнал course.cover_set', async () => {
  const f = await cover(c);
  const res = await setCourseCover(admin, c.courseId, f.id);
  assert.equal(res.cover, `/api/files/${f.id}`);
  const [row] = await db.sql<{ cover: string; coverFileId: string }>`SELECT cover, cover_file_id FROM courses WHERE id = ${c.courseId}`;
  assert.deepEqual([row?.cover, row?.coverFileId], [`/api/files/${f.id}`, f.id]);
  const [a] = await db.sql<{ meta: unknown; entity: string; actorId: string }>`SELECT meta, entity, actor_id FROM audit_log WHERE action = 'course.cover_set' AND entity_id = ${c.courseId}`;
  assert.deepEqual([a?.meta, a?.entity, a?.actorId], [{ fileId: f.id }, 'course', 'adm']);
});

test('обложка: чужой курс, материал вместо обложки, несуществующий и удалённый файл', async () => {
  const other = await cover(foreign);
  assert.equal(await code(setCourseCover(admin, c.courseId, other.id)), 'VALIDATION');
  const material = await upload(png(1200, 675), { purpose: 'lesson_material', courseId: c.courseId, lessonId: c.lessonIds[0] });
  assert.equal(await code(setCourseCover(admin, c.courseId, material.id)), 'VALIDATION');
  assert.equal(await code(setCourseCover(admin, c.courseId, '55555555-5555-4555-8555-555555555555')), 'FILE_NOT_FOUND');
  assert.equal(await code(setCourseCover(admin, '66666666-6666-4666-8666-666666666666', other.id)), 'NOT_FOUND');
  const gone = await cover(c);
  await deleteFile(admin, gone.id);
  assert.equal(await code(setCourseCover(admin, c.courseId, gone.id)), 'FILE_NOT_FOUND');
});

test('clearCourseCover обнуляет оба поля и пишет course.cover_clear', async () => {
  const [before] = await db.sql<{ coverFileId: string }>`SELECT cover_file_id FROM courses WHERE id = ${c.courseId}`;
  await clearCourseCover(admin, c.courseId);
  const [row] = await db.sql<{ cover: string | null; coverFileId: string | null }>`SELECT cover, cover_file_id FROM courses WHERE id = ${c.courseId}`;
  assert.deepEqual([row?.cover, row?.coverFileId], [null, null]);
  const [a] = await db.sql<{ meta: unknown }>`SELECT meta FROM audit_log WHERE action = 'course.cover_clear' AND entity_id = ${c.courseId}`;
  assert.deepEqual(a?.meta, { fileId: before?.coverFileId });
  // повтор без обложки — ничего не пишет
  await clearCourseCover(admin, c.courseId);
  const n = await db.sql`SELECT 1 FROM audit_log WHERE action = 'course.cover_clear' AND entity_id = ${c.courseId}`;
  assert.equal(n.length, 1);
});

test('deleteFile: используемый в уроке и текущая обложка → FILE_IN_USE; неиспользуемый → deleted, объект удалён', async () => {
  const used = await upload(pdf('u'), { purpose: 'lesson_material', courseId: c.courseId, lessonId: c.lessonIds[0] });
  await updateLesson(admin, c.courseId, c.lessonIds[0] as string, {
    titleRu: 'Урок',
    status: 'draft',
    durationMin: '1',
    content: { ru: { v: 1, blocks: [{ id: 'f', type: 'file', fileId: used.id, name: 'x', ext: 'pdf', sizeBytes: 1 }] } },
  });
  assert.equal(await code(deleteFile(admin, used.id)), 'FILE_IN_USE');

  const cv = await cover(c);
  await setCourseCover(admin, c.courseId, cv.id);
  assert.equal(await code(deleteFile(admin, cv.id)), 'FILE_IN_USE');

  const free = await upload(pdf('free'), { purpose: 'lesson_material', courseId: c.courseId, lessonId: c.lessonIds[0] });
  const [row] = await db.sql<{ storageKey: string }>`SELECT storage_key FROM files WHERE id = ${free.id}`;
  assert.equal(await exists(row!.storageKey), true);
  await deleteFile(admin, free.id);
  const [after] = await db.sql<{ status: string; deletedAt: number | null }>`SELECT status, deleted_at FROM files WHERE id = ${free.id}`;
  assert.equal(after?.status, 'deleted');
  assert.ok(after?.deletedAt);
  assert.equal(await exists(row!.storageKey), false);
  const [a] = await db.sql<{ meta: { courseId: string } }>`SELECT meta FROM audit_log WHERE action = 'file.delete' AND entity_id = ${free.id}`;
  assert.equal(a?.meta.courseId, c.courseId);
  assert.equal(await code(deleteFile(admin, free.id)), 'FILE_NOT_FOUND');
});

test('listCourseFiles показывает использование и обложку; storageUsage считает только активные', async () => {
  const items = await listCourseFiles(admin, c.courseId);
  assert.ok(items.length >= 2);
  const used = items.find((i) => i.usedIn.length > 0);
  assert.equal(used?.usedIn[0]?.lessonId, c.lessonIds[0]);
  assert.equal(items.filter((i) => i.isCover).length, 1);
  assert.ok(items.every((i) => i.url === `/api/files/${i.id}`));

  const usage = await storageUsage(admin, c.courseId);
  assert.equal(usage.courseBytes, items.reduce((n, i) => n + i.sizeBytes, 0));
  assert.ok(usage.totalBytes >= usage.courseBytes);
  assert.ok(usage.courseQuota > 0 && usage.totalQuota >= usage.courseQuota);
});

test('не админ → FORBIDDEN; флаг выключен → FEATURE_DISABLED', async () => {
  const f = await cover(c);
  assert.equal(await code(setCourseCover(learner, c.courseId, f.id)), 'FORBIDDEN');
  assert.equal(await code(deleteFile(learner, f.id)), 'FORBIDDEN');
  assert.equal(await code(listCourseFiles(learner, c.courseId)), 'FORBIDDEN');
  assert.equal(await code(clearCourseCover({ id: 'dem', role: 'admin' }, c.courseId)), 'FORBIDDEN');
  const off = setEnv({ FEATURE_UPLOADS: '0' });
  try {
    assert.equal(await code(setCourseCover(admin, c.courseId, f.id)), 'FEATURE_DISABLED');
    assert.equal(await code(clearCourseCover(admin, c.courseId)), 'FEATURE_DISABLED');
    assert.equal(await code(deleteFile(admin, f.id)), 'FEATURE_DISABLED');
    assert.equal(await code(listCourseFiles(admin, c.courseId)), 'FEATURE_DISABLED');
    assert.equal(await code(storageUsage(admin, c.courseId)), 'FEATURE_DISABLED');
  } finally {
    off();
  }
  const [row] = await db.sql<{ status: string }>`SELECT status FROM files WHERE id = ${f.id}`;
  assert.equal(row?.status, 'active', 'при выключенном флаге в БД ничего не пишется');
});
