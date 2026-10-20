// Показ файлов слушателю (4B, D-038): блоки «Изображение» и «Файл», ссылки в Markdown.
// Запуск — из files-learn-ui.test.ts (подмена next-intl в отдельном процессе).
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createElement } from 'react';
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import type { PublicBlock } from '../../../src/lib/content/types';

mock.module('next-intl/server', {
  namedExports: {
    getTranslations: async () => (key: string, v?: Record<string, string | number>) =>
      v ? `${key}(${Object.values(v).join('|')})` : key,
  },
});

const { Blocks } = await import('../../../src/components/learn/Blocks');
const { Markdown } = await import('../../../src/components/learn/Markdown');

const PDF = '3b9c6d1e-0a55-4c1c-9a39-0d5f0c7a1111';
const PNG = '3b9c6d1e-0a55-4c1c-9a39-0d5f0c7a2222';
const LABEL = 'В демо загруженные документы видит только администратор.';

const blocks: PublicBlock[] = [
  { id: 'b1', type: 'image', fileId: PNG, alt: 'Схема', caption: 'Рис. 1', width: 800, height: 450 },
  { id: 'b2', type: 'file', fileId: PDF, label: 'Памятка', name: 'memo.pdf', ext: 'pdf', sizeBytes: 2457600 },
  { id: 'b3', type: 'file', fileId: PNG, name: 'photo.png', ext: 'png', sizeBytes: 1024 },
  { id: 'b4', type: 'text', markdown: `[Памятка](/api/files/${PDF}) и ![схема](/api/files/${PNG})` },
];

async function render(props: { filesEnabled: boolean; hideDocuments?: boolean }) {
  const el = await Blocks({
    blocks,
    lessonId: 'l1',
    lessonTitle: 'Урок',
    locale: 'ru',
    quizStatus: {},
    documentIds: [PDF],
    ...props,
  });
  // асинхронные серверные компоненты (FileBlock) рендерим потоком и ждём готовности
  const stream = await renderToReadableStream(el);
  await stream.allReady;
  return new Response(stream).text();
}

test('Blocks: обычный показ — картинка, карточка файла со ссылкой «Скачать», ссылка в тексте с href', async () => {
  const out = await render({ filesEnabled: true });
  assert.match(out, new RegExp(`<img src="/api/files/${PNG}" width="800" height="450" alt="Схема"`));
  assert.ok(out.includes('Рис. 1'));
  assert.match(out, new RegExp(`href="/api/files/${PDF}" download="memo.pdf"`));
  assert.match(out, new RegExp(`<a href="/api/files/${PDF}">Памятка</a>`));
  assert.ok(out.includes('Памятка'), 'название для слушателя вместо имени файла');
  assert.ok(!out.includes('block.demoHidden'));
});

test('Blocks: демо у не-админа — документ подписью без href, изображения как обычно', async () => {
  const out = await render({ filesEnabled: true, hideDocuments: true });
  assert.ok(!out.includes(`href="/api/files/${PDF}"`), 'ссылки на документ нет ни в блоке, ни в тексте');
  assert.ok(!out.includes('download="memo.pdf"'), 'кнопки «Скачать» у документа нет');
  // подпись у блока документа и у ссылки в тексте
  assert.equal(out.split('block.demoHidden').length - 1, 2);
  assert.ok(out.includes('data-testid="file-demo-hidden"'));
  assert.ok(out.includes('data-testid="file-link-hidden"'));
  // изображение и блок «Файл» с изображением остаются
  assert.match(out, new RegExp(`<img src="/api/files/${PNG}" width="800"`));
  assert.match(out, new RegExp(`href="/api/files/${PNG}" download="photo.png"`));
});

test('Blocks: UPLOADS выключен — блоки не выводятся, картинки и ссылки в тексте тоже', async () => {
  const out = await render({ filesEnabled: false });
  assert.ok(!out.includes('/api/files/'));
  assert.ok(!out.includes('image-block') && !out.includes('file-block'));
  assert.ok(out.includes('Памятка'), 'текст ссылки остаётся');
});

test('Markdown: регистр id не важен, абсолютный адрес и ссылка со строкой запроса тоже скрываются', () => {
  const md = `[a](/api/files/${PDF.toUpperCase()}) [b](https://crp.example/api/files/${PDF}?x=1) [c](https://example.org)`;
  const out = renderToStaticMarkup(createElement(Markdown, { hiddenFileIds: [PDF], hiddenLabel: LABEL, children: md }));
  assert.ok(!out.includes('/api/files/'));
  assert.equal(out.split(LABEL).length - 1, 2);
  assert.ok(out.includes('href="https://example.org"'));
});

test('Markdown: без параметров — как раньше, ссылки на файлы с href', () => {
  const out = renderToStaticMarkup(createElement(Markdown, { children: `[a](/api/files/${PDF})` }));
  assert.ok(out.includes(`href="/api/files/${PDF}"`));
});
