// handleDownload на реальной БД и хранилище: вход, 404, правило публичного демо.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { enroll } from '../../src/lib/access';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { handleDownload, type HttpDeps } from '../../src/lib/files/http';
import {
  NON_DEMO,
  admin,
  makeCourse,
  makeStorageDir,
  pdf,
  publishLessons,
  seedUsers,
  setEnv,
  upload,
} from '../helpers/fileFixtures';

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;
let fileId = '';
let fileBytes: Buffer = Buffer.alloc(0);
const MISSING = '33333333-3333-4333-8333-333333333333';

const viewer = (who: { id: string; role: string } | null): HttpDeps => ({
  getUser: async () => who,
  clientIp: () => '10.1.1.1',
});
const req = (id: string, headers: Record<string, string> = {}) => new Request(`http://localhost/api/files/${id}`, { headers });

before(async () => {
  storage = await makeStorageDir();
  restore = setEnv({ ...NON_DEMO, STORAGE_DIR: storage.dir });
  db = await createTestDb();
  await seedUsers(db);
  const c = await makeCourse(db, { status: 'published' });
  await publishLessons(db, c.lessonIds);
  fileBytes = pdf('содержимое для скачивания');
  const f = await upload(fileBytes, { purpose: 'lesson_material', courseId: c.courseId, lessonId: c.lessonIds[0], name: 'Договор.pdf' });
  fileId = f.id;
  await db.sql`INSERT INTO lesson_files (lesson_id, file_id) VALUES (${c.lessonIds[0] as string}, ${fileId})`;
  await enroll({ userId: 'lrn', courseId: c.courseId, source: 'grant' });
});
after(async () => {
  restore();
  await db.close();
  await storage.cleanup();
});

test('гость → 302 на вход с возвратом на файл; несуществующий id — точно так же', async () => {
  const a = await handleDownload(req(fileId), fileId, viewer(null));
  const b = await handleDownload(req(MISSING), MISSING, viewer(null));
  assert.equal(a.status, 302);
  assert.equal(a.headers.get('location'), `/ru/login?next=%2Fapi%2Ffiles%2F${fileId}`);
  assert.equal(b.status, 302);
  assert.equal(b.headers.get('location'), `/ru/login?next=%2Fapi%2Ffiles%2F${MISSING}`);
  const ka = await handleDownload(req(fileId, { cookie: 'NEXT_LOCALE=kz' }), fileId, viewer(null));
  assert.ok(ka.headers.get('location')?.startsWith('/kz/login'));
});

test('вошедший без доступа → 404, неотличимо от несуществующего файла', async () => {
  const a = await handleDownload(req(fileId), fileId, viewer({ id: 'oth', role: 'learner' }));
  const b = await handleDownload(req(MISSING), MISSING, viewer({ id: 'oth', role: 'learner' }));
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
  assert.equal(await a.text(), await b.text());
  assert.deepEqual([...a.headers].sort(), [...b.headers].sort());
});

test('зачисленный скачивает файл: тело, заголовки, 304 по ETag', async () => {
  const res = await handleDownload(req(fileId), fileId, viewer({ id: 'lrn', role: 'learner' }));
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), fileBytes);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="[^"]*\.pdf"; filename\*=UTF-8''/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  const etag = res.headers.get('etag') as string;
  const again = await handleDownload(req(fileId, { 'if-none-match': etag }), fileId, viewer({ id: 'lrn', role: 'learner' }));
  assert.equal(again.status, 304);
  // доступ проверяется и до 304: посторонний с тем же ETag получает 404
  const stranger = await handleDownload(req(fileId, { 'if-none-match': etag }), fileId, viewer({ id: 'oth', role: 'learner' }));
  assert.equal(stranger.status, 404);
});

test('публичное демо: админ получает файл, зачисленный слушатель и гость — отказ, как для несуществующего id', async () => {
  const back = setEnv({ DATABASE_URL: undefined, DEMO_MODE: '1' });
  try {
    const asAdmin = await handleDownload(req(fileId), fileId, viewer(admin));
    assert.equal(asAdmin.status, 200);
    assert.deepEqual(Buffer.from(await asAdmin.arrayBuffer()), fileBytes);

    const learner = await handleDownload(req(fileId), fileId, viewer({ id: 'lrn', role: 'learner' }));
    const learnerMissing = await handleDownload(req(MISSING), MISSING, viewer({ id: 'lrn', role: 'learner' }));
    assert.equal(learner.status, 404);
    assert.equal(await learner.text(), await learnerMissing.text());

    const guest = await handleDownload(req(fileId), fileId, viewer(null));
    assert.equal(guest.status, 302);
    assert.equal(guest.headers.get('location'), `/ru/login?next=%2Fapi%2Ffiles%2F${fileId}`);
  } finally {
    back();
  }
});

test('вне демо тот же слушатель получает файл (правило демо не влияет на прод)', async () => {
  const res = await handleDownload(req(fileId), fileId, viewer({ id: 'lrn', role: 'learner' }));
  assert.equal(res.status, 200);
  await res.arrayBuffer();
});

test('админ скачивает и вне демо; объект пропал → 404 с логом; флаг выключен → 404 даже админу', async () => {
  const r = await handleDownload(req(fileId), fileId, viewer(admin));
  assert.equal(r.status, 200);
  await r.arrayBuffer();

  const off = setEnv({ FEATURE_UPLOADS: '0' });
  try {
    assert.equal((await handleDownload(req(fileId), fileId, viewer(admin))).status, 404);
  } finally {
    off();
  }

  const [row] = await db.sql<{ storageKey: string }>`SELECT storage_key FROM files WHERE id = ${fileId}`;
  await rm(path.join(storage.dir, 'objects', row!.storageKey));
  const logged: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    assert.equal((await handleDownload(req(fileId), fileId, viewer(admin))).status, 404);
  } finally {
    console.error = orig;
  }
  assert.deepEqual(logged, [['[files] объект отсутствует', fileId]]);
});

test('лимит частоты выдачи: после исчерпания 429 с Retry-After', async () => {
  let last: Response | null = null;
  for (let i = 0; i < 601; i++) last = await handleDownload(req(MISSING), MISSING, viewer({ id: 'rate-user', role: 'learner' }));
  assert.equal(last?.status, 429);
  assert.ok(Number(last?.headers.get('retry-after')) >= 1);
});
