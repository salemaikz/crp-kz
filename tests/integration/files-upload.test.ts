// storeUpload: проверки, запись, очистка метаданных, квоты, журнал.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { UploadError, type UploadErrorCode } from '../../src/lib/files/types';
import {
  NON_DEMO,
  chunked,
  docx,
  docxWithVba,
  jpeg,
  JPEG_EXIF_MARK,
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
import { storeUpload } from '../../src/lib/files/store';

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;
let course: TestCourse;
let other: TestCourse;

before(async () => {
  storage = await makeStorageDir();
  restore = setEnv({ FEATURE_UPLOADS: '1', STORAGE_DIR: storage.dir, UPLOAD_QUOTA_BYTES: undefined, UPLOAD_COURSE_QUOTA_BYTES: undefined });
  db = await createTestDb();
  await seedUsers(db);
  course = await makeCourse(db);
  other = await makeCourse(db);
});
after(async () => {
  restore();
  await db.close();
  await storage.cleanup();
});

async function rejectsWith(p: Promise<unknown>, code: UploadErrorCode): Promise<UploadError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof UploadError, `ожидалась UploadError, получено ${String(e)}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`ожидалась ошибка ${code}`);
}

async function objectFiles(): Promise<string[]> {
  const out: string[] = [];
  const root = path.join(storage.dir, 'objects');
  for (const d of await readdir(root).catch(() => [] as string[])) {
    for (const f of await readdir(path.join(root, d))) out.push(path.join(root, d, f));
  }
  return out;
}
const tmpFiles = () => readdir(path.join(storage.dir, '.tmp')).catch(() => [] as string[]);
const countFiles = async () => Number((await db.sql<{ n: number }>`SELECT count(*)::int AS n FROM files`)[0]?.n);

test('админ загружает PNG: строка, объект без EXIF, sha256, журнал без имени файла', async () => {
  const secret = 'Ivan-Petrov-Private';
  const src = png(32, 24, { text: secret });
  const f = await upload(src, { purpose: 'lesson_material', courseId: course.courseId, lessonId: course.lessonIds[0], name: 'Фото Иван Петров.png' });
  assert.equal(f.ext, 'png');
  assert.equal(f.kind, 'image');
  assert.equal(f.mime, 'image/png');
  assert.equal(f.url, `/api/files/${f.id}`);
  assert.deepEqual([f.width, f.height], [32, 24]);
  assert.equal(f.name, 'Фото Иван Петров.png');

  const [row] = await db.sql<{ storageKey: string; sha256: string; sizeBytes: number; courseId: string; uploadedBy: string; status: string }>`
    SELECT storage_key, sha256, size_bytes, course_id, uploaded_by, status FROM files WHERE id = ${f.id}`;
  assert.equal(row?.status, 'active');
  assert.equal(row?.courseId, course.courseId);
  assert.equal(row?.uploadedBy, 'adm');
  const stored = await readFile(path.join(storage.dir, 'objects', row!.storageKey));
  assert.equal(stored.includes(Buffer.from(secret)), false, 'tEXt удалён');
  assert.equal(createHash('sha256').update(stored).digest('hex'), row?.sha256);
  assert.equal(stored.length, row?.sizeBytes);
  assert.equal(f.sizeBytes, stored.length);
  assert.deepEqual(await tmpFiles(), []);

  const [audit] = await db.sql<{ meta: Record<string, unknown>; actorId: string; entity: string }>`
    SELECT meta, actor_id, entity FROM audit_log WHERE action = 'file.upload' AND entity_id = ${f.id}`;
  assert.equal(audit?.actorId, 'adm');
  assert.equal(audit?.entity, 'file');
  assert.deepEqual(audit?.meta, { courseId: course.courseId, lessonId: course.lessonIds[0], purpose: 'lesson_material', ext: 'png', sizeBytes: stored.length });
  assert.equal('name' in (audit?.meta ?? {}), false, 'Ж-5: в meta нет ключа name');
  assert.equal(JSON.stringify(audit?.meta).includes('Иван'), false);
});

test('JPEG: EXIF удалён из объекта', async () => {
  const f = await upload(jpeg(40, 30, { exif: true }), { purpose: 'lesson_material', courseId: course.courseId, lessonId: course.lessonIds[0], name: 'a.jpeg' });
  assert.equal(f.ext, 'jpg');
  assert.equal(f.name, 'a.jpg');
  const [row] = await db.sql<{ storageKey: string }>`SELECT storage_key FROM files WHERE id = ${f.id}`;
  const stored = await readFile(path.join(storage.dir, 'objects', row!.storageKey));
  assert.equal(stored.includes(Buffer.from(JPEG_EXIF_MARK)), false);
});

test('PDF и DOCX принимаются как материал урока; объект с режимом 0600', async () => {
  const p = await upload(pdf(), { purpose: 'lesson_material', courseId: course.courseId, lessonId: course.lessonIds[0], name: 'Памятка.PDF.exe' });
  assert.deepEqual([p.kind, p.ext, p.name], ['document', 'pdf', 'Памятка.PDF.pdf']);
  const d = await upload(docx(), { purpose: 'lesson_material', courseId: course.courseId, lessonId: course.lessonIds[0], name: 'x.docx' });
  assert.equal(d.ext, 'docx');
  const [row] = await db.sql<{ storageKey: string }>`SELECT storage_key FROM files WHERE id = ${p.id}`;
  const { stat } = await import('node:fs/promises');
  assert.equal((await stat(path.join(storage.dir, 'objects', row!.storageKey))).mode & 0o777, 0o600);
});

test('не админ и пониженный админ (роль в БД сменилась) → forbidden', async () => {
  const args = { purpose: 'lesson_material' as const, courseId: course.courseId, lessonId: course.lessonIds[0] };
  await rejectsWith(upload(png(), { ...args, actor: learner }), 'forbidden');
  await rejectsWith(upload(png(), { ...args, actor: { id: 'dem', role: 'admin' } }), 'forbidden');
});

test('урок другого курса, без урока, курса нет → not_found', async () => {
  await rejectsWith(upload(png(), { purpose: 'lesson_material', courseId: course.courseId, lessonId: other.lessonIds[0] }), 'not_found');
  await rejectsWith(upload(png(), { purpose: 'lesson_material', courseId: course.courseId }), 'not_found');
  await rejectsWith(upload(png(), { purpose: 'lesson_material', courseId: '11111111-1111-4111-8111-111111111111', lessonId: course.lessonIds[0] }), 'not_found');
  await rejectsWith(upload(png(), { purpose: 'lesson_material', courseId: 'not-uuid', lessonId: course.lessonIds[0] }), 'not_found');
});

test('реальный размер больше заявленного → too_large, временный файл удалён, строки нет', async () => {
  const before = await countFiles();
  const body = png(16, 16);
  await rejectsWith(
    storeUpload({ actor: { id: 'adm', role: 'admin' }, purpose: 'lesson_material', courseId: course.courseId, lessonId: course.lessonIds[0], name: 'x', declaredSize: body.length - 10, body: chunked(body, 20) }),
    'too_large',
  );
  assert.equal(await countFiles(), before);
  assert.deepEqual(await tmpFiles(), []);
});

test('тело короче заявленного и пустое тело', async () => {
  const body = png(16, 16);
  const args = { actor: { id: 'adm', role: 'admin' }, purpose: 'lesson_material' as const, courseId: course.courseId, lessonId: course.lessonIds[0], name: 'x' };
  await rejectsWith(storeUpload({ ...args, declaredSize: body.length + 5, body: chunked(body) }), 'bad_request');
  await rejectsWith(storeUpload({ ...args, declaredSize: 0, body: chunked(body) }), 'empty');
  await rejectsWith(storeUpload({ ...args, declaredSize: 10, body: chunked(new Uint8Array(0)) }), 'empty');
  assert.deepEqual(await tmpFiles(), []);
});

test('заявленный размер выше лимита → too_large без чтения тела', async () => {
  const trap = (async function* () {
    throw new Error('тело читать нельзя');
  })();
  const e = await rejectsWith(
    storeUpload({ actor: { id: 'adm', role: 'admin' }, purpose: 'course_cover', courseId: course.courseId, name: 'x', declaredSize: 6 * 1024 * 1024, body: trap }),
    'too_large',
  );
  assert.equal(e.status, 413);
});

test('обложка: 600x400 → image_too_small, PDF → bad_type, подходящая принимается', async () => {
  await rejectsWith(upload(png(600, 400), { purpose: 'course_cover', courseId: course.courseId }), 'image_too_small');
  await rejectsWith(upload(pdf(), { purpose: 'course_cover', courseId: course.courseId }), 'bad_type');
  const ok = await upload(png(1200, 675), { purpose: 'course_cover', courseId: course.courseId });
  assert.equal(ok.ext, 'png');
});

test('типы: SVG и HTML под видом PNG → bad_type, макросы → macro, картинка слишком большая → image_too_large', async () => {
  const args = { purpose: 'lesson_material' as const, courseId: course.courseId, lessonId: course.lessonIds[0] };
  await rejectsWith(upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { ...args, name: 'a.svg' }), 'bad_type');
  await rejectsWith(upload(Buffer.from('<html><script>1</script></html>'), { ...args, name: 'fake.png' }), 'bad_type');
  await rejectsWith(upload(docxWithVba(), { ...args, name: 'a.docx' }), 'macro');
  await rejectsWith(upload(png(10_001, 4), { ...args, name: 'big.png' }), 'image_too_large');
});

test('квота курса: исчерпана → quota, объект не остаётся', async () => {
  const q = await makeCourse(db);
  const restoreQuota = setEnv({ UPLOAD_COURSE_QUOTA_BYTES: String(pdf().length * 2 + 10) });
  try {
    const args = { purpose: 'lesson_material' as const, courseId: q.courseId, lessonId: q.lessonIds[0] };
    await upload(pdf('a'), args);
    await upload(pdf('b'), args);
    const objects = (await objectFiles()).length;
    const e = await rejectsWith(upload(pdf('c'), args), 'quota');
    assert.equal(e.status, 507);
    assert.equal((await objectFiles()).length, objects);
  } finally {
    restoreQuota();
  }
});

test('параллельные загрузки у границы квоты: сумма не превышает квоту, объекты = активные строки', async () => {
  const q = await makeCourse(db);
  const one = pdf('x').length;
  const restoreQuota = setEnv({ UPLOAD_COURSE_QUOTA_BYTES: String(one * 2 + 5) });
  try {
    const args = { purpose: 'lesson_material' as const, courseId: q.courseId, lessonId: q.lessonIds[0] };
    const results = await Promise.allSettled([upload(pdf('1'), args), upload(pdf('2'), args), upload(pdf('3'), args)]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(ok, 2);
    const [sum] = await db.sql<{ s: number }>`SELECT COALESCE(SUM(size_bytes), 0)::float8 AS s FROM files WHERE course_id = ${q.courseId} AND status = 'active'`;
    assert.ok((sum?.s ?? 0) <= one * 2 + 5);
    const keys = await db.sql<{ storageKey: string }>`SELECT storage_key FROM files WHERE status = 'active'`;
    const onDisk = (await objectFiles()).map((p) => p.split(path.sep).slice(-2).join('/')).sort();
    assert.deepEqual(onDisk, keys.map((k) => k.storageKey).sort());
  } finally {
    restoreQuota();
  }
});

test('флаг выключен → disabled', async () => {
  const r = setEnv({ FEATURE_UPLOADS: '0' });
  try {
    const e = await rejectsWith(upload(png(), { purpose: 'lesson_material', courseId: course.courseId, lessonId: course.lessonIds[0] }), 'disabled');
    assert.equal(e.status, 404);
  } finally {
    r();
  }
});

test('вне демо без STORAGE_DIR → storage_unavailable, tmpdir не подставляется', async () => {
  const r = setEnv({ ...NON_DEMO, STORAGE_DIR: undefined });
  try {
    const e = await rejectsWith(upload(png(), { purpose: 'lesson_material', courseId: course.courseId, lessonId: course.lessonIds[0] }), 'storage_unavailable');
    assert.equal(e.status, 503);
  } finally {
    r();
  }
});
