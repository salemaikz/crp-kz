// collectFileRefs: блоки image/file и ссылки в Markdown обеих локалей.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Block, LessonContent } from '../../src/lib/content/types';
import { collectFileRefs } from '../../src/lib/files/refs';

const A = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';
const B = 'a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d';
const C = '0b6d3f52-8f0e-4c3a-9d36-6f0b8c1a2e11';

const text = (markdown: string): Block => ({ id: 't', type: 'text', markdown });
const doc = (blocks: Block[]) => ({ v: 1 as const, blocks });
const ru = (...blocks: Block[]): LessonContent => ({ ru: doc(blocks) });
const ids = (c: LessonContent) => collectFileRefs(c).map((r) => `${r.locale}:${r.blockIndex}:${r.field}:${r.need}:${r.fileId}`);

test('блоки image и file', () => {
  const c = ru(
    { id: 'i', type: 'image', fileId: A, alt: 'x', width: 1, height: 1 },
    { id: 'f', type: 'file', fileId: B, name: 'a.pdf', ext: 'pdf', sizeBytes: 1 },
  );
  assert.deepEqual(ids(c), [`ru:0:fileId:image:${A}`, `ru:1:fileId:any:${B}`]);
});

test('Markdown: картинка требует изображение, ссылка — любой вид', () => {
  assert.deepEqual(ids(ru(text(`![схема](/api/files/${A})`))), [`ru:0:markdown:any:${A}`, `ru:0:markdown:image:${A}`]);
  assert.deepEqual(ids(ru(text(`[памятка](/api/files/${A})`))), [`ru:0:markdown:any:${A}`]);
});

test('Markdown: абсолютный адрес, запрос, несколько ссылок в строке, определения ссылок', () => {
  const md = `см. [а](https://crp.example/api/files/${A}?x=1) и ![б](/api/files/${B} "подпись") и [в](</api/files/${C}>)\n\n[ref]: /api/files/${A}`;
  assert.deepEqual(ids(ru(text(md))), [
    `ru:0:markdown:any:${A}`,
    `ru:0:markdown:any:${B}`,
    `ru:0:markdown:any:${C}`,
    `ru:0:markdown:image:${B}`,
  ]);
});

test('голый абсолютный адрес и <https://…> — ссылки любого вида (GFM делает их ссылками)', () => {
  assert.deepEqual(ids(ru(text(`Скачайте: https://learn.example/api/files/${A}`))), [`ru:0:markdown:any:${A}`]);
  assert.deepEqual(ids(ru(text(`Скачайте: <https://learn.example/api/files/${B}>`))), [`ru:0:markdown:any:${B}`]);
});

test('картинка по определению: ![x][r] требует изображение, [x][r] — любой вид', () => {
  assert.deepEqual(ids(ru(text(`![x][r]\n\n[r]: /api/files/${A}`))), [`ru:0:markdown:any:${A}`, `ru:0:markdown:image:${A}`]);
  assert.deepEqual(ids(ru(text(`![r]\n\n[R]: /api/files/${A}`))), [`ru:0:markdown:any:${A}`, `ru:0:markdown:image:${A}`]);
  assert.deepEqual(ids(ru(text(`[x][r]\n\n[r]: /api/files/${A}`))), [`ru:0:markdown:any:${A}`]);
});

test('вложенные скобки в подписи картинки', () => {
  assert.deepEqual(ids(ru(text(`![рис [1]](/api/files/${A})`))), [`ru:0:markdown:any:${A}`, `ru:0:markdown:image:${A}`]);
});

test('id с лишними символами не совпадает; голый адрес считается ссылкой (GFM автоссылка)', () => {
  assert.deepEqual(ids(ru(text(`![x](/api/files/${A}a)`))), []);
  assert.deepEqual(ids(ru(text(`![x](/api/files/${A}-1)`))), []);
  assert.deepEqual(ids(ru(text(`просто текст /api/files/${A}`))), [`ru:0:markdown:any:${A}`]);
  assert.deepEqual(ids(ru(text('![x](/api/files/not-an-id)'))), []);
});

test('верхний регистр приводится к нижнему', () => {
  assert.deepEqual(ids(ru(text(`[x](/api/files/${A.toUpperCase()})`))), [`ru:0:markdown:any:${A}`]);
});

test('ссылки в kz и дубликаты', () => {
  const c: LessonContent = {
    ru: doc([text(`![x](/api/files/${A})`)]),
    kz: doc([text('текст'), text(`![x](/api/files/${A}) ![y](/api/files/${A})`)]),
  };
  assert.deepEqual(ids(c), [`ru:0:markdown:any:${A}`, `ru:0:markdown:image:${A}`, `kz:1:markdown:any:${A}`, `kz:1:markdown:image:${A}`]);
});

test('контент без файлов — пустой список', () => {
  assert.deepEqual(collectFileRefs(ru({ id: 'h', type: 'heading', level: 2, text: 'Заголовок' })), []);
});
