// updateLesson со ссылками на файлы: проверка, снимки из БД, lesson_files.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AdminError, updateLesson } from '../../src/lib/admin';
import { deleteLesson } from '../../src/lib/admin/structure';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { deleteFile } from '../../src/lib/files/admin';
import {
  admin,
  makeCourse,
  makeStorageDir,
  pdf,
  png,
  seedUsers,
  setEnv,
  upload,
  type TestCourse,
} from '../helpers/fileFixtures';
import type { StoredFile } from '../../src/lib/files/types';

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;
let c: TestCourse;
let foreign: TestCourse;
let img: StoredFile;
let doc: StoredFile;
let foreignImg: StoredFile;

before(async () => {
  storage = await makeStorageDir();
  restore = setEnv({ FEATURE_UPLOADS: '1', STORAGE_DIR: storage.dir });
  db = await createTestDb();
  await seedUsers(db);
  c = await makeCourse(db, { lessons: 2 });
  foreign = await makeCourse(db);
  const at = { purpose: 'lesson_material' as const, courseId: c.courseId, lessonId: c.lessonIds[0] };
  img = await upload(png(30, 20), { ...at, name: 'схема.png' });
  doc = await upload(pdf(), { ...at, name: 'Памятка.pdf' });
  foreignImg = await upload(png(5, 5), { purpose: 'lesson_material', courseId: foreign.courseId, lessonId: foreign.lessonIds[0] });
});
after(async () => {
  restore();
  await db.close();
  await storage.cleanup();
});

const lessonId = () => c.lessonIds[0] as string;

function save(blocksRu: unknown[], blocksKz?: unknown[], id = lessonId()): Promise<{ slug: string }> {
  return updateLesson(admin, c.courseId, id, {
    titleRu: 'Урок',
    status: 'draft',
    durationMin: '5',
    content: { ru: { v: 1, blocks: blocksRu }, ...(blocksKz ? { kz: { v: 1, blocks: blocksKz } } : {}) },
  });
}

async function linked(id = lessonId()): Promise<string[]> {
  const rows = await db.sql<{ fileId: string }>`SELECT file_id FROM lesson_files WHERE lesson_id = ${id} ORDER BY file_id`;
  return rows.map((r) => r.fileId);
}

async function validation(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof AdminError);
    assert.equal(e.code, 'VALIDATION');
    return e;
  }
  assert.fail('ожидалась VALIDATION');
}

const imageBlock = (f: StoredFile, over: object = {}) => ({ id: 'img', type: 'image', fileId: f.id, alt: 'Схема', width: f.width, height: f.height, ...over });
const fileBlock = (f: StoredFile, over: object = {}) => ({ id: 'doc', type: 'file', fileId: f.id, label: 'Памятка', name: f.name, ext: f.ext, sizeBytes: f.sizeBytes, ...over });
const textBlock = (markdown: string) => ({ id: 'txt', type: 'text', markdown });

test('image, file и Markdown-ссылка → lesson_files из трёх id; снимки переписаны из БД; журнал: files', async () => {
  const another = await upload(png(9, 9), { purpose: 'lesson_material', courseId: c.courseId, lessonId: lessonId() });
  await save([
    imageBlock(img, { width: 9999, height: 1 }), // подмена снимка на клиенте
    fileBlock(doc, { name: 'подмена.exe', ext: 'png', sizeBytes: 1 }),
    textBlock(`вот ![рис](/api/files/${another.id}) картинка`),
  ]);
  assert.deepEqual(await linked(), [img.id, doc.id, another.id].sort());

  const [row] = await db.sql<{ content: { ru: { blocks: Array<Record<string, unknown>> } } }>`SELECT content FROM lessons WHERE id = ${lessonId()}`;
  const [i, f] = row!.content.ru.blocks as [Record<string, unknown>, Record<string, unknown>];
  assert.deepEqual([i.width, i.height], [30, 20]);
  assert.deepEqual([f.name, f.ext, f.sizeBytes], [doc.name, 'pdf', doc.sizeBytes]);

  const audit = await db.sql<{ meta: { files: number } }>`SELECT meta FROM audit_log WHERE action = 'lesson.update' AND entity_id = ${lessonId()} ORDER BY created_at DESC, id`;
  assert.ok(audit.some((a) => a.meta.files === 3));
});

test('удаление блока убирает строку lesson_files', async () => {
  await save([imageBlock(img), fileBlock(doc)]);
  assert.deepEqual(await linked(), [img.id, doc.id].sort());
  await save([imageBlock(img)]);
  assert.deepEqual(await linked(), [img.id]);
  await save([]);
  assert.deepEqual(await linked(), []);
});

test('kz-копия блоков: одна строка на файл', async () => {
  await save([imageBlock(img)], [imageBlock(img, { alt: 'Сурет' }), fileBlock(doc)]);
  assert.deepEqual(await linked(), [img.id, doc.id].sort());
});

test('файл другого курса, несуществующий и без привязки к материалу → file_not_found с путём к блоку', async () => {
  const e = await validation(save([textBlock('x'), imageBlock(foreignImg)]));
  assert.deepEqual(e.issues?.map((i) => [i.code, i.path]), [['file_not_found', ['ru', 'blocks', 1, 'fileId']]]);
  assert.equal(e.fields?.content, 'invalid');

  const ghost = '22222222-2222-4222-8222-222222222222';
  const e2 = await validation(save([textBlock('x')], [textBlock(`[файл](/api/files/${ghost})`)]));
  assert.deepEqual(e2.issues?.map((i) => [i.code, i.path]), [['file_not_found', ['kz', 'blocks', 0, 'markdown']]]);

  const cover = await upload(png(1200, 675), { purpose: 'course_cover', courseId: c.courseId });
  const e3 = await validation(save([imageBlock(cover)]));
  assert.equal(e3.issues?.[0]?.code, 'file_not_found', 'обложка — не материал урока');
});

test('удалённый файл → file_not_found', async () => {
  const gone = await upload(png(7, 7), { purpose: 'lesson_material', courseId: c.courseId, lessonId: lessonId() });
  await deleteFile(admin, gone.id);
  const e = await validation(save([imageBlock(gone)]));
  assert.equal(e.issues?.[0]?.code, 'file_not_found');
});

test('картинка Markdown на PDF и блок image на PDF → file_wrong_kind; ссылка на PDF разрешена', async () => {
  const e = await validation(save([textBlock(`![x](/api/files/${doc.id})`)]));
  assert.equal(e.issues?.[0]?.code, 'file_wrong_kind');
  const e2 = await validation(save([imageBlock(doc, { width: 10, height: 10 })]));
  assert.equal(e2.issues?.[0]?.code, 'file_wrong_kind');
  await save([textBlock(`[памятка](/api/files/${doc.id})`)]);
  assert.deepEqual(await linked(), [doc.id]);
});

test('голый абсолютный адрес и <https://…> — тоже ссылки: чужой файл → file_not_found, свой попадает в lesson_files', async () => {
  const e = await validation(save([textBlock(`Скачайте: https://learn.example/api/files/${foreignImg.id}`)]));
  assert.deepEqual(e.issues?.map((i) => [i.code, i.path]), [['file_not_found', ['ru', 'blocks', 0, 'markdown']]]);
  const e2 = await validation(save([textBlock(`Скачайте: <https://learn.example/api/files/${foreignImg.id}>`)]));
  assert.equal(e2.issues?.[0]?.code, 'file_not_found');
  await save([textBlock(`Памятка: https://learn.example/api/files/${doc.id}`)]);
  assert.deepEqual(await linked(), [doc.id]);
});

test('картинка по определению на PDF → file_wrong_kind', async () => {
  const e = await validation(save([textBlock(`![x][r]\n\n[r]: /api/files/${doc.id}`)]));
  assert.equal(e.issues?.[0]?.code, 'file_wrong_kind');
});

test('ошибка проверки ссылок откатывает сохранение целиком', async () => {
  await save([imageBlock(img)]);
  await validation(save([textBlock('новое'), imageBlock(foreignImg)]));
  assert.deepEqual(await linked(), [img.id]);
  const [row] = await db.sql<{ content: { ru: { blocks: unknown[] } } }>`SELECT content FROM lessons WHERE id = ${lessonId()}`;
  assert.equal(row?.content.ru.blocks.length, 1);
});

test('проверка ссылок не зависит от флага UPLOADS', async () => {
  const r = setEnv({ FEATURE_UPLOADS: '0' });
  try {
    await save([imageBlock(img)]);
    assert.deepEqual(await linked(), [img.id]);
    await validation(save([imageBlock(foreignImg)]));
  } finally {
    r();
  }
});

test('после deleteLesson файл становится сиротой (строка lesson_files уходит каскадом)', async () => {
  const second = c.lessonIds[1] as string;
  await save([imageBlock(img)], undefined, second);
  assert.deepEqual(await linked(second), [img.id]);
  await deleteLesson(admin, second);
  const rows = await db.sql`SELECT 1 FROM lesson_files WHERE lesson_id = ${second}`;
  assert.equal(rows.length, 0);
});
