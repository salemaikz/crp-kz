// «Моё обучение» при CERT_PDF: ссылка на PDF только у сертификата опубликованного курса с пригодным текстом.
// Запускается из learn-list-certs.test.ts в отдельном процессе с --experimental-test-module-mocks.
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTestDb, type TestDb } from '../../../src/lib/db/testing';
import { PDF_COURSE_SLUG, seedPdf } from './learn-certificate-pdf.seed';

const src = (rel: string) => new URL(`../../../src/${rel}`, import.meta.url).href;

let current: { id: string } | null = null;

mock.module('next-intl/server', {
  namedExports: {
    getTranslations: async (arg?: string | { namespace: string }) => {
      const ns = typeof arg === 'string' ? arg : arg?.namespace;
      return (key: string) => `${ns}.${key}`;
    },
    setRequestLocale: () => {},
  },
});
mock.module(src('lib/i18n/navigation.ts'), {
  namedExports: {
    Link: ({ href, children }: { href: string; children?: unknown }) => createElement('a', { href }, children as never),
    useRouter: () => ({}),
    usePathname: () => '/',
    redirect: () => {
      throw new Error('REDIRECT');
    },
  },
});
mock.module(src('lib/auth/index.ts'), {
  namedExports: { getCurrentUser: async () => current, requireUser: async () => current },
});
// карточка курса — клиентский компонент с next-intl, для проверки не нужна
mock.module(src('components/learn/CourseCard.tsx'), { namedExports: { CourseCard: () => createElement('div') } });

const { default: LearnPage } = await import('../../../src/app/[locale]/learn/page');

let db: TestDb;
before(async () => {
  db = await createTestDb();
  await seedPdf(db);
  // один слушатель: сертификаты на опубликованный курс, на черновик и на курс с непригодным названием
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('list-user', 'list@crp-pdf.invalid', 'Нав Тест', 1)`;
  await db.sql`INSERT INTO certificates (id, number, user_id, course_id, holder_name, locale, issued_at) VALUES
    ('list-c1', 'CRP-2026-LIST01', 'list-user', 'pdf-c1', 'Марат Нурланов', 'ru', 1760000000003),
    ('list-draft', 'CRP-2026-LIST02', 'list-user', 'pdf-draft', 'Марат Нурланов', 'ru', 1760000000002),
    ('list-c2', 'CRP-2026-LIST03', 'list-user', 'pdf-c2', 'Марат Нурланов', 'ru', 1760000000001)`;
});
after(async () => {
  await db.close();
});

const keep = process.env.FEATURE_CERT_PDF;
test.afterEach(() => {
  if (keep === undefined) delete process.env.FEATURE_CERT_PDF;
  else process.env.FEATURE_CERT_PDF = keep;
});

async function html(user: string): Promise<string> {
  current = { id: user };
  return renderToStaticMarkup(await LearnPage({ params: Promise.resolve({ locale: 'ru' }) }));
}

const pdfLinks = (out: string) => [...out.matchAll(/href="([^"]*\/certificate\/pdf)"/g)].map((m) => m[1]);

test('CERT_PDF включён: PDF-ссылка только у опубликованного курса с нормальным текстом', async () => {
  process.env.FEATURE_CERT_PDF = '1';
  const out = await html('list-user');
  // три сертификата в списке, ссылка на файл — одна: на pdf-c1
  assert.equal(out.match(/CRP-2026-LIST0\d/g)?.length, 3);
  assert.deepEqual(pdfLinks(out), [`/ru/learn/${PDF_COURSE_SLUG}/certificate/pdf`]);
  assert.ok(!out.includes('/learn/pdf-draft/certificate/pdf'));
});

test('CERT_PDF включён: имя, для которого planCertificatePdf не ok, — ссылки на PDF нет', async () => {
  process.env.FEATURE_CERT_PDF = '1';
  for (const user of ['pdf-emoji', 'pdf-partial', 'pdf-long']) {
    const out = await html(user);
    assert.ok(out.includes('/certificate"') || out.includes('/certificate<'), `${user}: сертификат в списке`);
    assert.deepEqual(pdfLinks(out), [], user);
  }
});

test('CERT_PDF выключен: ссылок на PDF нет вообще', async () => {
  process.env.FEATURE_CERT_PDF = '0';
  assert.deepEqual(pdfLinks(await html('pdf-ru')), []);
});

test('CERT_PDF включён, имя нормальное: ссылка у владельца опубликованного курса есть', async () => {
  process.env.FEATURE_CERT_PDF = '1';
  assert.deepEqual(pdfLinks(await html('pdf-ru')), [`/ru/learn/${PDF_COURSE_SLUG}/certificate/pdf`]);
});
