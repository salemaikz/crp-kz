// Страницы /legal/* и подвал при включённом и выключенном LEGAL, с подменой next/* и next-intl.
// Запускается из legal-pages.test.ts в отдельном процессе с --experimental-test-module-mocks.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const src = (rel: string) => new URL(`../../../src/${rel}`, import.meta.url).href;

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
  },
});
mock.module('next/image', { defaultExport: () => createElement('img') });
mock.module(src('lib/auth/index.ts'), { namedExports: { getCurrentUser: async () => null } });

const { default: IndexPage } = await import('../../../src/app/[locale]/legal/page');
const { default: DocPage } = await import('../../../src/app/[locale]/legal/[doc]/page');
const { default: VersionPage } = await import('../../../src/app/[locale]/legal/[doc]/[version]/page');
const { Footer } = await import('../../../src/components/layout/Footer');

const p = <T,>(v: T) => Promise.resolve(v);
const calls = {
  index: () => IndexPage({ params: p({ locale: 'ru' }) }),
  doc: () => DocPage({ params: p({ locale: 'ru', doc: 'offer' }) }),
  version: () => VersionPage({ params: p({ locale: 'ru', doc: 'offer', version: '2026-10-20' }) }),
};
const footerHtml = async () => renderToStaticMarkup(await Footer());

const keep = { flag: process.env.FEATURE_LEGAL, demo: process.env.DEMO_MODE, db: process.env.DATABASE_URL };
function setEnv(o: { flag?: string; demo?: string; db?: string }) {
  for (const [k, v] of [['FEATURE_LEGAL', o.flag], ['DEMO_MODE', o.demo], ['DATABASE_URL', o.db]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
test.afterEach(() => setEnv({ flag: keep.flag, demo: keep.demo, db: keep.db }));

test('LEGAL выключен: все страницы документов дают 404, в подвале нет колонки', async () => {
  setEnv({ flag: '0', demo: '1' });
  for (const [name, call] of Object.entries(calls)) await assert.rejects(call(), /NOT_FOUND/, name);
  assert.ok(!(await footerHtml()).includes('footer-legal'));
});

test('LEGAL включён в демо: страницы отдают разметку, в подвале колонка со ссылками', async () => {
  setEnv({ flag: '1', demo: '1' });
  for (const [name, call] of Object.entries(calls)) assert.ok(await call(), name);
  const html = await footerHtml();
  assert.ok(html.includes('footer-legal'));
  assert.ok(html.includes('href="/legal/offer"'));
});

test('прод без демо: LEGAL включён, но документы черновики — 404 и подвал без колонки', async () => {
  setEnv({ flag: '1', db: 'postgres://prod.invalid/db' });
  for (const [name, call] of Object.entries(calls)) await assert.rejects(call(), /NOT_FOUND/, name);
  assert.ok(!(await footerHtml()).includes('footer-legal'));
});

test('неизвестный документ и версия при включённом LEGAL — 404', async () => {
  setEnv({ flag: '1', demo: '1' });
  await assert.rejects(DocPage({ params: p({ locale: 'ru', doc: '../offer' }) }), /NOT_FOUND/);
  await assert.rejects(VersionPage({ params: p({ locale: 'ru', doc: 'offer', version: '1999-01-01' }) }), /NOT_FOUND/);
});
