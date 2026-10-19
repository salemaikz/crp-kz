// Маршрут GET …/certificate/pdf как функция, с подменой сессии, next-intl и рендера.
// Запускается из learn-certificate-pdf.test.ts в отдельном процессе с --experimental-test-module-mocks.
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { createTestDb, type TestDb } from '../../../src/lib/db/testing';
import { EMOJI_NUMBER, EMPTY_COURSE_SLUG, PDF_COURSE_SLUG, PDF_NUMBER, seedPdf } from './learn-certificate-pdf.seed';

const src = (rel: string) => new URL(`../../../src/${rel}`, import.meta.url).href;

let current: { id: string } | null = null;
let renders = 0;
let renderFails = false;

mock.module(src('lib/auth/index.ts'), { namedExports: { getCurrentUser: async () => current } });
mock.module('next-intl/server', {
  namedExports: {
    getTranslations: async (arg?: { namespace: string }) => (key: string) => `${arg?.namespace}.${key}`,
  },
});
mock.module(src('lib/learn/pdf/render.ts'), {
  namedExports: {
    renderCertificatePdf: async () => {
      renders++;
      if (renderFails) throw new Error('boom');
      return new TextEncoder().encode('%PDF-1.7 fake %%EOF');
    },
  },
});

const { GET } = await import('../../../src/app/[locale]/learn/[slug]/certificate/pdf/route');

let db: TestDb;
before(async () => {
  db = await createTestDb();
  await seedPdf(db);
});
after(async () => {
  await db.close();
});

const keep = process.env.FEATURE_CERT_PDF;
test.afterEach(() => {
  if (keep === undefined) delete process.env.FEATURE_CERT_PDF;
  else process.env.FEATURE_CERT_PDF = keep;
  renderFails = false;
});

const call = (locale = 'ru', slug = PDF_COURSE_SLUG, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/${locale}/learn/${slug}/certificate/pdf`, { headers }), {
    params: Promise.resolve({ locale, slug }),
  });

test('флаг выключен: 404 без обращения к рендеру, даже владельцу', async () => {
  process.env.FEATURE_CERT_PDF = '0';
  current = { id: 'pdf-owner' };
  const before = renders;
  const res = await call();
  assert.equal(res.status, 404);
  assert.equal(renders, before);
});

test('гость: 303 на вход, возврат — на страницу сертификата, а не на PDF', async () => {
  current = null;
  const res = await call('kz');
  assert.equal(res.status, 303);
  const loc = res.headers.get('location')!;
  assert.ok(loc.startsWith('/kz/login?next='));
  assert.equal(decodeURIComponent(loc.split('next=')[1]!), `/kz/learn/${PDF_COURSE_SLUG}/certificate`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('владелец: 200, PDF и заголовки без публичного кэша', async () => {
  current = { id: 'pdf-owner' };
  const res = await call();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="${PDF_NUMBER}.pdf"`);
  assert.equal(res.headers.get('cache-control'), 'private, no-cache');
  assert.equal(res.headers.get('vary'), 'Cookie');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('etag')!, /^W\/"[0-9a-f]{32}"$/);
  assert.equal(new TextDecoder().decode(await res.arrayBuffer()).slice(0, 5), '%PDF-');
});

test('имя пустое после очистки: 303 на HTML-страницу сертификата той же локали, рендера нет', async () => {
  current = { id: 'pdf-emoji' };
  const before = renders;
  for (const locale of ['ru', 'kz']) {
    const res = await call(locale);
    assert.equal(res.status, 303, EMOJI_NUMBER);
    assert.equal(res.headers.get('location'), `/${locale}/learn/${PDF_COURSE_SLUG}/certificate`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal(renders, before, 'рендер для пустого имени вызывался');
});

test('PDF недоступен: пустой курс при обычном имени, неотображаемые буквы, не влезает по высоте — 303, рендера нет', async () => {
  const before = renders;
  const cases: { user: string; slug: string; what: string }[] = [
    { user: 'pdf-empty', slug: EMPTY_COURSE_SLUG, what: 'пустой курс при обычном имени' },
    { user: 'pdf-partial', slug: PDF_COURSE_SLUG, what: 'часть букв имени без глифа' },
    { user: 'pdf-long', slug: PDF_COURSE_SLUG, what: 'имя не влезает по высоте' },
  ];
  for (const c of cases) {
    current = { id: c.user };
    for (const locale of ['ru', 'kz']) {
      const res = await call(locale, c.slug);
      assert.equal(res.status, 303, c.what);
      assert.equal(res.headers.get('location'), `/${locale}/learn/${c.slug}/certificate`, c.what);
      assert.equal(res.headers.get('cache-control'), 'no-store', c.what);
    }
  }
  assert.equal(renders, before, 'рендер при недоступном PDF вызывался');
});

test('чужой сертификат, несуществующий курс и курс без сертификата — одинаковый 404', async () => {
  current = { id: 'pdf-other' };
  const foreign = await call();
  const noCourse = await call('ru', 'net-takogo-kursa');
  assert.equal(foreign.status, 404);
  assert.equal(noCourse.status, 404);
  assert.equal(await foreign.text(), await noCourse.text());
  // сертификат есть, но курс в черновике
  current = { id: 'pdf-owner' };
  assert.equal((await call('ru', 'pdf-draft')).status, 404);
});

test('If-None-Match совпал: 304 без рендера; чужому тот же ETag не помогает', async () => {
  current = { id: 'pdf-owner' };
  const etag = (await call()).headers.get('etag')!;
  const before = renders;
  const res = await call('ru', PDF_COURSE_SLUG, { 'if-none-match': etag });
  assert.equal(res.status, 304);
  assert.equal(res.headers.get('etag'), etag);
  assert.equal(res.headers.get('cache-control'), 'private, no-cache');
  assert.equal(renders, before, 'рендер при 304 вызывался');
  // список и слабое сравнение
  assert.equal((await call('ru', PDF_COURSE_SLUG, { 'if-none-match': `"x", ${etag.replace('W/', '')}` })).status, 304);
  // другой ETag — полный ответ
  assert.equal((await call('ru', PDF_COURSE_SLUG, { 'if-none-match': 'W/"0000"' })).status, 200);
  // посторонний с тем же ETag получает 404, а не 304
  current = { id: 'pdf-other' };
  assert.equal((await call('ru', PDF_COURSE_SLUG, { 'if-none-match': etag })).status, 404);
});

test('11-й запрос за минуту — 429 с Retry-After', async () => {
  current = { id: 'pdf-ru' };
  for (let i = 0; i < 10; i++) assert.equal((await call()).status, 200, `запрос ${i + 1}`);
  const res = await call();
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) >= 1);
  assert.equal(await res.text(), 'learn.certificate.pdfTooMany');
});

test('ошибка рендера: 500 без деталей клиенту, в журнал — номер и причина без ПДн', async () => {
  current = { id: 'pdf-owner' };
  renderFails = true;
  const logged: string[] = [];
  const spy = mock.method(console, 'error', (...a: unknown[]) => void logged.push(a.map(String).join(' ')));
  try {
    const res = await call();
    assert.equal(res.status, 500);
    assert.equal(await res.text(), 'Internal error');
  } finally {
    spy.mock.restore();
  }
  assert.equal(logged.length, 1);
  assert.ok(logged[0]!.includes(PDF_NUMBER));
  assert.ok(logged[0]!.includes('error=Error') && logged[0]!.includes('message=boom'), logged[0]);
  assert.ok(!logged[0]!.includes('Әлия') && !logged[0]!.includes('@'), 'ФИО или email в логе');
});

test('неизвестная локаль в адресе не ломает маршрут: берётся ru', async () => {
  current = null;
  const res = await call('xx');
  assert.equal(res.status, 303);
  assert.ok(res.headers.get('location')!.startsWith('/ru/login?next='));
});

/** Новый владелец сертификата: у лимита 10 запросов в минуту на пользователя, общий владелец уже исчерпан. */
async function freshOwner(id: string, courseId = 'pdf-c1'): Promise<{ id: string }> {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES (${id}, ${`${id}@crp-pdf.invalid`}, 'Нав Тест', 1)`;
  await db.sql`INSERT INTO certificates (id, number, user_id, course_id, holder_name, locale, issued_at)
    VALUES (${`c-${id}`}, ${`CRP-2026-${id.toUpperCase()}`}, ${id}, ${courseId}, 'Нав Тест', 'ru', 1760000000000)`;
  return { id };
}

const NAV = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

test('навигация браузера: нет сертификата, чужой, черновик (сертификат есть), нет курса — 303 на /{locale}/learn', async () => {
  const cases: [string, string, string][] = [
    ['pdf-other', PDF_COURSE_SLUG, 'pdf-c1'],
    ['pdf-draft-owner', 'pdf-draft', 'pdf-draft'],
    ['pdf-nocourse-owner', 'net-takogo-kursa', 'pdf-c1'],
  ];
  for (const [user, slug, courseId] of cases) {
    current = user === 'pdf-other' ? { id: user } : await freshOwner(user, courseId);
    if (courseId === 'pdf-draft') {
      // сертификат на черновик действительно есть: иначе проверялся бы случай «нет сертификата»
      const rows = await db.sql`SELECT 1 FROM certificates WHERE user_id = ${user} AND course_id = 'pdf-draft'`;
      assert.equal(rows.length, 1);
    }
    for (const locale of ['ru', 'kz']) {
      const res = await call(locale, slug, NAV);
      assert.equal(res.status, 303, `${user} ${slug}`);
      assert.equal(res.headers.get('location'), `/${locale}/learn`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  }
});

test('навигация: флаг выключен — по-прежнему 404, а не редирект', async () => {
  process.env.FEATURE_CERT_PDF = '0';
  current = { id: 'pdf-owner' };
  assert.equal((await call('ru', PDF_COURSE_SLUG, NAV)).status, 404);
});

test('503 (адрес сайта не настроен): навигация — 303 на страницу сертификата с ?pdf=unavailable, иначе прежний 503', async () => {
  const keepSite = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'ftp://invalid';
  try {
    current = await freshOwner('pdf-nav503');
    for (const locale of ['ru', 'kz']) {
      const res = await call(locale, PDF_COURSE_SLUG, NAV);
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), `/${locale}/learn/${PDF_COURSE_SLUG}/certificate?pdf=unavailable`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    const plain = await call();
    assert.equal(plain.status, 503);
    assert.equal(await plain.text(), 'Service unavailable');
    assert.match(plain.headers.get('content-type')!, /^text\/plain/);
  } finally {
    if (keepSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = keepSite;
  }
});

test('500 (ошибка рендера): навигация — 303 на страницу сертификата с ?pdf=unavailable, иначе прежний 500', async () => {
  current = await freshOwner('pdf-nav500');
  renderFails = true;
  const spy = mock.method(console, 'error', () => {});
  try {
    const nav = await call('kz', PDF_COURSE_SLUG, NAV);
    assert.equal(nav.status, 303);
    assert.equal(nav.headers.get('location'), `/kz/learn/${PDF_COURSE_SLUG}/certificate?pdf=unavailable`);
    const plain = await call();
    assert.equal(plain.status, 500);
    assert.equal(await plain.text(), 'Internal error');
  } finally {
    spy.mock.restore();
  }
});

test('навигация: успешный запрос остаётся 200 с PDF', async () => {
  current = await freshOwner('pdf-nav200');
  const res = await call('ru', PDF_COURSE_SLUG, NAV);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
});
