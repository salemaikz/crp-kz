// handleUpload: проверка источника, заголовки, лимиты, ответы. Тело не читается до проверок.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { handleUpload, type HttpDeps } from '../../src/lib/files/http';
import { admin, learner, makeCourse, makeStorageDir, pdf, png, seedUsers, setEnv, type TestCourse } from '../helpers/fileFixtures';

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;
let course: TestCourse;

const deps = (who: { id: string; role: string } | null = admin): HttpDeps => ({ getUser: async () => who, clientIp: () => null });

before(async () => {
  storage = await makeStorageDir();
  restore = setEnv({ FEATURE_UPLOADS: '1', STORAGE_DIR: storage.dir });
  db = await createTestDb();
  await seedUsers(db);
  course = await makeCourse(db);
});
after(async () => {
  restore();
  await db.close();
  await storage.cleanup();
});

/** Тело-ловушка: любое чтение — ошибка. */
function trapBody(onRead: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull() {
        onRead();
        throw new Error('тело читать нельзя');
      },
    },
    { highWaterMark: 0 }, // без предзаполнения: pull вызывается только при реальном чтении
  );
}

type Opts = {
  query?: string;
  headers?: Record<string, string | null>;
  body?: Uint8Array | ReadableStream<Uint8Array>;
  length?: number | null;
};

function request(o: Opts = {}): Request {
  const body = o.body ?? png(16, 16);
  const length = o.length === undefined ? (body instanceof Uint8Array ? body.length : null) : o.length;
  const headers: Record<string, string> = {
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/octet-stream',
    'x-upload-name': encodeURIComponent('Отчёт.png'),
    ...(length === null ? {} : { 'content-length': String(length) }),
  };
  for (const [k, v] of Object.entries(o.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  const query = o.query ?? `purpose=lesson_material&courseId=${course.courseId}&lessonId=${course.lessonIds[0]}`;
  return new Request(`http://localhost/api/uploads?${query}`, {
    method: 'POST',
    headers,
    body: body as BodyInit,
    duplex: 'half',
  } as RequestInit);
}

async function json(res: Response): Promise<{ ok: boolean; error?: string; params?: Record<string, number>; file?: { id: string; name: string } }> {
  return (await res.json()) as never;
}

test('успех: 201, файл в ответе, no-store и nosniff', async () => {
  const res = await handleUpload(request(), deps());
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const body = await json(res);
  assert.equal(body.ok, true);
  assert.equal(body.file?.name, 'Отчёт.png');
});

test('cross-site → 403 без чтения тела; Origin другого хоста и отсутствие обоих заголовков — тоже', async () => {
  let reads = 0;
  const trap = () => trapBody(() => reads++);
  const a = await handleUpload(request({ body: trap(), length: 100, headers: { 'sec-fetch-site': 'cross-site' } }), deps());
  assert.equal(a.status, 403);
  assert.equal((await json(a)).error, 'cross_site');
  const b = await handleUpload(request({ body: trap(), length: 100, headers: { 'sec-fetch-site': null, origin: 'https://evil.example', host: 'crp.example' } }), deps());
  assert.equal(b.status, 403);
  const c = await handleUpload(request({ body: trap(), length: 100, headers: { 'sec-fetch-site': null } }), deps());
  assert.equal(c.status, 403);
  assert.equal(reads, 0);
});

test('без Sec-Fetch-Site допустим Origin своего хоста (в том числе за прокси)', async () => {
  const own = await handleUpload(request({ headers: { 'sec-fetch-site': null, origin: 'https://crp.example', 'x-forwarded-host': 'crp.example' } }), deps());
  assert.equal(own.status, 201);
  const behind = await handleUpload(request({ headers: { 'sec-fetch-site': null, origin: 'https://crp.example', 'x-forwarded-host': 'crp.example, proxy.internal' } }), deps());
  assert.equal(behind.status, 201);
});

test('нет Content-Length → 411; слишком большой → 413 без чтения тела', async () => {
  let reads = 0;
  const noLen = await handleUpload(request({ body: trapBody(() => reads++), length: null }), deps());
  assert.equal(noLen.status, 411);
  assert.equal((await json(noLen)).error, 'length_required');
  const big = await handleUpload(request({ body: trapBody(() => reads++), length: 26 * 1024 * 1024 }), deps());
  assert.equal(big.status, 413);
  const b = await json(big);
  assert.equal(b.error, 'too_large');
  assert.ok((b.params?.max ?? 0) > 0);
  assert.equal(reads, 0);
});

test('некорректный X-Upload-Name, Content-Type и параметры → 400', async () => {
  for (const name of [null, 'caf\u00e9.png', '%E0%A4%A', 'a'.repeat(1025), 'a b']) {
    const res = await handleUpload(request({ headers: { 'x-upload-name': name } }), deps());
    assert.equal(res.status, 400, String(name));
    assert.equal((await json(res)).error, 'bad_request');
  }
  assert.equal((await handleUpload(request({ headers: { 'content-type': 'multipart/form-data' } }), deps())).status, 400);
  assert.equal((await handleUpload(request({ query: `purpose=submission&courseId=${course.courseId}` }), deps())).status, 400);
});

test('гость и не админ → 403; курс не найден → 404', async () => {
  assert.equal((await handleUpload(request(), deps(null))).status, 403);
  const res = await handleUpload(request(), deps(learner));
  assert.equal(res.status, 403);
  assert.equal((await json(res)).error, 'forbidden');
  const nf = await handleUpload(request({ query: 'purpose=course_cover&courseId=44444444-4444-4444-8444-444444444444' }), deps());
  assert.equal(nf.status, 404);
});

test('тип по сигнатуре: HTML под видом PNG → 415; PDF принимается', async () => {
  const bad = await handleUpload(request({ body: Buffer.from('<html>'), headers: { 'x-upload-name': 'a.png' } }), deps());
  assert.equal(bad.status, 415);
  assert.equal((await json(bad)).error, 'bad_type');
  assert.equal((await handleUpload(request({ body: pdf(), headers: { 'x-upload-name': 'a.pdf' } }), deps())).status, 201);
});

test('флаг выключен → 404 до чтения тела и сессии', async () => {
  const off = setEnv({ FEATURE_UPLOADS: '0' });
  try {
    let reads = 0;
    let sessions = 0;
    const res = await handleUpload(request({ body: trapBody(() => reads++), length: 10 }), {
      getUser: async () => (sessions++, admin),
      clientIp: () => null,
    });
    assert.equal(res.status, 404);
    assert.equal((await json(res)).error, 'disabled');
    assert.deepEqual([reads, sessions], [0, 0]);
  } finally {
    off();
  }
});

test('лимит частоты: после 60 загрузок за окно — 429', async () => {
  const user = { id: 'adm', role: 'admin' };
  let last = 0;
  const statuses = new Set<number>();
  for (let i = 0; i < 70 && last !== 429; i++) {
    const res = await handleUpload(request({ body: Buffer.from('hello'), headers: { 'x-upload-name': 'a.png' } }), deps(user));
    last = res.status;
    statuses.add(last);
  }
  assert.equal(last, 429);
  assert.ok(statuses.has(415) || statuses.has(201));
});
