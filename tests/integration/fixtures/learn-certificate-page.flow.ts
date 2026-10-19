// Страница сертификата при включённом CERT_PDF: ссылка на PDF или печать браузером + пояснение.
// Запускается из learn-certificate-page.test.ts в отдельном процессе с --experimental-test-module-mocks.
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isDemo } from '../../../src/lib/env';
import { createTestDb, type TestDb } from '../../../src/lib/db/testing';
import { EMPTY_COURSE_SLUG, PDF_COURSE_SLUG, seedPdf } from './learn-certificate-pdf.seed';

const src = (rel: string) => new URL(`../../../src/${rel}`, import.meta.url).href;

let current: { id: string } | null = null;

mock.module('next/navigation', {
  namedExports: {
    notFound: () => {
      throw new Error('NOT_FOUND');
    },
    unstable_rethrow: () => {},
  },
});
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
// клиентские компоненты с next-intl: для проверки нужны только их признаки в разметке
mock.module(src('components/learn/PrintButton.tsx'), {
  namedExports: { PrintButton: () => createElement('button', { 'data-testid': 'print-certificate' }) },
});
mock.module(src('components/learn/CertificateSheet.tsx'), {
  namedExports: {
    CertificateSheet: ({ qrSrc }: { qrSrc?: string | null }) =>
      createElement('div', { 'data-testid': 'certificate', 'data-qr': qrSrc ? 'yes' : 'no' }),
  },
});
// layout: тяжёлые куски (шрифты next/font, шапка) не нужны, проверяется только generateMetadata
mock.module(src('styles/fonts.ts'), { namedExports: { fontVariables: '' } });
mock.module(src('components/layout/index.ts'), {
  namedExports: { DemoBanner: () => null, Footer: () => null, Header: () => null },
});
mock.module(src('components/account/VerifyEmailNotice.tsx'), { namedExports: { VerifyEmailNotice: () => null } });
mock.module('next/image', { defaultExport: () => createElement('img') });

const { generateMetadata: layoutMetadata } = await import('../../../src/app/[locale]/layout');
const { default: CertificatePage } = await import('../../../src/app/[locale]/learn/[slug]/certificate/page');

let db: TestDb;
before(async () => {
  db = await createTestDb();
  await seedPdf(db);
});
after(async () => {
  await db.close();
});

const keep = { flag: process.env.FEATURE_CERT_PDF, demo: process.env.DEMO_MODE };
test.afterEach(() => {
  for (const [k, v] of [['FEATURE_CERT_PDF', keep.flag], ['DEMO_MODE', keep.demo]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function html(user: string, slug: string, search: { pdf?: string } = {}): Promise<string> {
  process.env.DEMO_MODE = '1';
  current = { id: user };
  return renderToStaticMarkup(await CertificatePage({ params: Promise.resolve({ locale: 'ru', slug }), searchParams: Promise.resolve(search) }));
}

test('CERT_PDF включён, текст пригоден: ссылка на PDF, печати и пояснения нет', async () => {
  process.env.FEATURE_CERT_PDF = '1';
  const out = await html('pdf-ru', PDF_COURSE_SLUG);
  assert.ok(out.includes('data-testid="download-certificate-pdf"'));
  assert.ok(out.includes(`/ru/learn/${PDF_COURSE_SLUG}/certificate/pdf`));
  assert.ok(!out.includes('print-certificate'));
  assert.ok(!out.includes('pdfUnavailable'));
  assert.ok(out.includes('learn.certificate.pdfHint'));
});

test('CERT_PDF включён, PDF недоступен: печать браузером и пояснение, ссылки на PDF нет', async () => {
  process.env.FEATURE_CERT_PDF = '1';
  const cases = [
    ['pdf-emoji', PDF_COURSE_SLUG, 'пустое имя'],
    ['pdf-empty', EMPTY_COURSE_SLUG, 'пустой курс при обычном имени'],
    ['pdf-partial', PDF_COURSE_SLUG, 'часть букв имени без глифа'],
    ['pdf-long', PDF_COURSE_SLUG, 'имя не влезает по высоте'],
  ] as const;
  for (const [user, slug, what] of cases) {
    const out = await html(user, slug);
    assert.ok(out.includes('data-testid="print-certificate"'), what);
    assert.ok(!out.includes('download-certificate-pdf') && !out.includes('/certificate/pdf'), what);
    assert.ok(out.includes('learn.certificate.pdfUnavailable'), what);
    assert.ok(!out.includes('learn.certificate.pdfHint'), what);
  }
});

test('CERT_PDF выключен: печать без пояснения про PDF', async () => {
  process.env.FEATURE_CERT_PDF = '0';
  const out = await html('pdf-partial', PDF_COURSE_SLUG);
  assert.ok(out.includes('print-certificate'));
  assert.ok(!out.includes('pdfUnavailable'));
  assert.ok(out.includes('learn.certificate.printHint'));
});

/** Вне демо: DATABASE_URL задан (isDemo() === false), адрес сайта — как передан. */
async function htmlOutsideDemo(site: string | undefined): Promise<string> {
  const keepEnv = { site: process.env.NEXT_PUBLIC_SITE_URL, db: process.env.DATABASE_URL, node: process.env.NODE_ENV };
  const env = process.env as Record<string, string | undefined>;
  try {
    if (site === undefined) delete env.NEXT_PUBLIC_SITE_URL;
    else env.NEXT_PUBLIC_SITE_URL = site;
    env.FEATURE_CERT_PDF = '0';
    delete env.DEMO_MODE;
    env.DATABASE_URL = 'postgres://stub@localhost/stub'; // страница ходит в тестовую БД через мок, не в эту
    env.NODE_ENV = 'production';
    assert.equal(isDemo(), false);
    current = { id: 'pdf-ru' };
    return renderToStaticMarkup(
      await CertificatePage({ params: Promise.resolve({ locale: 'ru', slug: PDF_COURSE_SLUG }), searchParams: Promise.resolve({}) }),
    );
  } finally {
    for (const [k, v] of [['NEXT_PUBLIC_SITE_URL', keepEnv.site], ['DATABASE_URL', keepEnv.db], ['NODE_ENV', keepEnv.node]] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}

test('вне демо адрес не URL, не https или не задан: страница рендерится без QR, печать работает', async () => {
  for (const site of ['not a url', 'localhost:3000', 'http://learn.crp.kz', undefined]) {
    const out = await htmlOutsideDemo(site);
    assert.ok(out.includes('print-certificate'), String(site));
    assert.ok(out.includes('data-qr="no"'), String(site));
  }
});

test('вне демо https-адрес задан: QR есть', async () => {
  const out = await htmlOutsideDemo('https://learn.crp.kz');
  assert.ok(out.includes('data-qr="yes"'));
});

test('generateMetadata layout: кривой NEXT_PUBLIC_SITE_URL не бросает, metadataBase не задаётся', async () => {
  const keepSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = 'not a url';
    const bad = await layoutMetadata({ params: Promise.resolve({ locale: 'ru' }) });
    assert.equal(bad.metadataBase, undefined);
    process.env.NEXT_PUBLIC_SITE_URL = 'https://learn.crp.kz';
    const ok = await layoutMetadata({ params: Promise.resolve({ locale: 'ru' }) });
    assert.equal(new URL(String(ok.metadataBase)).host, 'learn.crp.kz');
  } finally {
    if (keepSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = keepSite;
  }
});

test('?pdf=unavailable: PDF не предлагается снова, есть печать и пояснение', async () => {
  process.env.FEATURE_CERT_PDF = '1';
  const out = await html('pdf-ru', PDF_COURSE_SLUG, { pdf: 'unavailable' });
  assert.ok(!out.includes('download-certificate-pdf'));
  assert.ok(!out.includes('/certificate/pdf'));
  assert.ok(out.includes('print-certificate'));
  assert.ok(out.includes('certificate-pdf-unavailable'));
});
