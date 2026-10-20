// handleDownload с заглушками БД и хранилища: заголовки всех видов ответов.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { handleDownload, type HttpDeps } from '../../src/lib/files/http';
import type { FileRow } from '../../src/lib/files/types';

const ID = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';
const SHA = 'a'.repeat(64);

const base: FileRow = {
  id: ID, storage: 'local', storageKey: `3f/${ID}`, purpose: 'lesson_material', kind: 'document', mime: 'application/pdf',
  ext: 'pdf', sizeBytes: 5, sha256: SHA, originalName: 'Отчёт 2026.pdf', width: null, height: null, courseId: 'c', lessonId: 'l',
  uploadedBy: 'u', status: 'active', createdAt: 1, deletedAt: null,
};

let saved: string | undefined;
before(() => {
  saved = process.env.FEATURE_UPLOADS;
  process.env.FEATURE_UPLOADS = '1';
});
after(() => {
  if (saved === undefined) delete process.env.FEATURE_UPLOADS;
  else process.env.FEATURE_UPLOADS = saved;
});

let seq = 0;
function deps(opts: { file?: Partial<FileRow> | null; allow?: boolean; cache?: 'public' | 'private'; object?: boolean; user?: boolean } = {}): HttpDeps {
  const uid = `user-${seq++}`;
  const file = opts.file === null ? null : { ...base, ...opts.file };
  return {
    getUser: async () => (opts.user === false ? null : { id: uid, role: 'learner' }),
    clientIp: () => `10.0.0.${seq}`,
    source: {
      findFile: async () => file,
      canRead: async () => (opts.allow === false ? { ok: false } : { ok: true, cache: opts.cache ?? 'private' }),
      open: async () =>
        opts.object === false ? null : { size: 5, body: new Response('hello').body as ReadableStream<Uint8Array> },
    },
  };
}

const req = (headers: Record<string, string> = {}) => new Request(`http://localhost/api/files/${ID}`, { headers });

function assertSecure(res: Response): void {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
}

test('PDF: attachment, Content-Type из строки БД, nosniff, CSP sandbox, CORP, ETag', async () => {
  const res = await handleDownload(req(), ID, deps());
  assert.equal(res.status, 200);
  assertSecure(res);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="[\x20-\x7E]+"; filename\*=UTF-8''/);
  assert.equal(res.headers.get('etag'), `"${SHA}"`);
  assert.equal(res.headers.get('cache-control'), 'private, no-cache');
  assert.equal(res.headers.get('accept-ranges'), 'none');
  assert.equal(res.headers.get('content-length'), '5');
  assert.equal(await res.text(), 'hello');
});

test('PNG: inline; Content-Type берётся из строки, а не из имени', async () => {
  const res = await handleDownload(req(), ID, deps({ file: { kind: 'image', mime: 'image/png', ext: 'png', originalName: 'evil.html.png' } }));
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok((res.headers.get('content-disposition') ?? '').startsWith('inline;'));
  const odd = await handleDownload(req(), ID, deps({ file: { kind: 'document', mime: 'application/pdf', originalName: 'page.html' } }));
  assert.equal(odd.headers.get('content-type'), 'application/pdf');
});

test('публичная обложка кешируется публично', async () => {
  const res = await handleDownload(req(), ID, deps({ cache: 'public' }));
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
});

test('If-None-Match → 304 без тела, с теми же защитными заголовками', async () => {
  for (const inm of [`"${SHA}"`, `W/"${SHA}"`, `"x", "${SHA}"`]) {
    const res = await handleDownload(req({ 'if-none-match': inm }), ID, deps());
    assert.equal(res.status, 304);
    assertSecure(res);
    assert.equal(res.headers.get('etag'), `"${SHA}"`);
  }
  assert.equal((await handleDownload(req({ 'if-none-match': '"other"' }), ID, deps())).status, 200);
});

test('отказ: гость → 302 на вход, вошедший → 404; оба с защитными заголовками и без различий для «нет файла»', async () => {
  const guestDenied = await handleDownload(req(), ID, deps({ allow: false, user: false }));
  const guestMissing = await handleDownload(req(), ID, deps({ file: null, user: false }));
  for (const res of [guestDenied, guestMissing]) {
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `/ru/login?next=%2Fapi%2Ffiles%2F${ID}`);
    assertSecure(res);
  }
  const userDenied = await handleDownload(req(), ID, deps({ allow: false }));
  const userMissing = await handleDownload(req(), ID, deps({ file: null }));
  for (const res of [userDenied, userMissing]) {
    assert.equal(res.status, 404);
    assertSecure(res);
  }
  assert.equal(await userDenied.text(), await userMissing.text());
});

test('локаль гостя из cookie NEXT_LOCALE; мусорный id не доходит до БД', async () => {
  const res = await handleDownload(req({ cookie: 'NEXT_LOCALE=kz' }), ID, deps({ allow: false, user: false }));
  assert.equal(res.headers.get('location'), `/kz/login?next=%2Fapi%2Ffiles%2F${ID}`);
  let touched = false;
  const d = deps();
  d.source = { ...d.source!, findFile: async () => ((touched = true), null) };
  const bad = await handleDownload(req(), '../../etc/passwd', d);
  assert.equal(bad.status, 404);
  assert.equal(touched, false);
});

test('объекта нет → 404', async () => {
  const res = await handleDownload(req(), ID, deps({ object: false }));
  assert.equal(res.status, 404);
  assertSecure(res);
});

test('флаг выключен → 404 для всех', async () => {
  process.env.FEATURE_UPLOADS = '0';
  try {
    const res = await handleDownload(req(), ID, deps());
    assert.equal(res.status, 404);
    assertSecure(res);
  } finally {
    process.env.FEATURE_UPLOADS = '1';
  }
});
