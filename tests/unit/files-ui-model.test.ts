// Модель интерфейса загрузки (4B): допустимые типы, предпроверка, разбор ответа, вставка картинки, блоки из загрузки.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBlocks, newFileBlock, newImageBlock } from '@/components/admin/lesson/blockModel';
import { describeIssue } from '@/components/admin/lesson/issueText';
import {
  acceptFor,
  extsFor,
  insertAtCursor,
  limitFor,
  nameExt,
  parseUploadResponse,
  isWrongKind,
  precheck,
  wrongKindByName,
  purposeOf,
  typesLabel,
} from '@/components/admin/files/uploadModel';
import type { StoredFile } from '@/lib/files/types';

const MiB = 1024 * 1024;
const limits = { image: 5 * MiB, document: 25 * MiB };
const stored: StoredFile = {
  id: '11111111-1111-4111-8111-111111111111',
  url: '/api/files/11111111-1111-4111-8111-111111111111',
  name: 'plan.pdf',
  kind: 'document',
  ext: 'pdf',
  mime: 'application/pdf',
  sizeBytes: 2048,
  width: null,
  height: null,
};

test('допустимые типы: картинка и обложка только изображения, файл — все шесть', () => {
  assert.deepEqual([...extsFor('image')], ['png', 'jpg', 'webp']);
  assert.deepEqual([...extsFor('cover')], ['png', 'jpg', 'webp']);
  assert.equal(extsFor('file').length, 6);
  assert.equal(purposeOf('cover'), 'course_cover');
  assert.equal(purposeOf('file'), 'lesson_material');
  assert.equal(typesLabel('image'), 'PNG, JPEG, WebP');
  assert.match(acceptFor('image'), /\.png/);
  assert.match(acceptFor('image'), /\.jpeg/);
  assert.ok(!acceptFor('image').includes('pdf'));
  assert.match(acceptFor('file'), /application\/pdf/);
});

test('предел размера: картинки по пределу картинки, документы по документному', () => {
  assert.equal(nameExt('Скан.PDF'), 'pdf');
  assert.equal(nameExt('noext'), '');
  assert.equal(limitFor('file', 'a.png', limits), limits.image);
  assert.equal(limitFor('file', 'a.pdf', limits), limits.document);
  assert.equal(limitFor('cover', 'a.pdf', limits), limits.image);
});

test('предпроверка: пустой файл и превышение предела; демо-предел 4 МБ учитывается', () => {
  assert.deepEqual(precheck({ name: 'a.pdf', size: 0 }, 'file', limits), { code: 'empty' });
  assert.equal(precheck({ name: 'a.pdf', size: 1024 }, 'file', limits), null);
  const over = precheck({ name: 'a.pdf', size: 4 * MiB + 1 }, 'file', { image: 4 * MiB, document: 4 * MiB });
  assert.deepEqual(over, { code: 'too_large', params: { max: 4 * MiB } });
  assert.equal(precheck({ name: 'a.png', size: 6 * MiB }, 'image', limits)?.code, 'too_large');
});

test('ответ сервера: файл, код ошибки с параметрами, мусор — generic', () => {
  const ok = parseUploadResponse(201, { ok: true, file: stored });
  assert.ok(ok.ok && ok.file.id === stored.id);
  assert.deepEqual(parseUploadResponse(413, { ok: false, error: 'too_large', params: { max: 4194304 } }), {
    ok: false,
    code: 'too_large',
    params: { max: 4194304 },
  });
  assert.deepEqual(parseUploadResponse(415, { ok: false, error: 'bad_type' }), { ok: false, code: 'bad_type' });
  // неизвестный код, не JSON (413 площадки), успех не с тем статусом
  assert.deepEqual(parseUploadResponse(500, { ok: false, error: 'boom' }), { ok: false, code: 'generic' });
  assert.deepEqual(parseUploadResponse(413, null), { ok: false, code: 'generic' });
  assert.deepEqual(parseUploadResponse(200, { ok: true, file: stored }), { ok: false, code: 'generic' });
  assert.deepEqual(parseUploadResponse(201, { ok: true, file: { id: 1 } }), { ok: false, code: 'generic' });
});

test('вставка картинки: в позицию курсора, выделение заменяется, позиция за пределами сжимается', () => {
  assert.deepEqual(insertAtCursor('abcdef', 3, 3, 'X'), { value: 'abcXdef', caret: 4 });
  assert.deepEqual(insertAtCursor('abcdef', 1, 4, 'X'), { value: 'aXef', caret: 2 });
  assert.deepEqual(insertAtCursor('abc', 99, 99, '![](/api/files/x)'), { value: 'abc![](/api/files/x)', caret: 20 });
  assert.deepEqual(insertAtCursor('', 0, 0, 'X'), { value: 'X', caret: 1 });
});

test('блоки из загрузки: alt пустой до заполнения, снимок файла сохранён', () => {
  const img = newImageBlock({ ...stored, kind: 'image', ext: 'png', width: 800, height: 450 });
  assert.equal(img.type, 'image');
  assert.equal(img.alt, '');
  assert.equal(img.width, 800);
  const file = newFileBlock(stored);
  assert.deepEqual({ ...file, id: '' }, { id: '', type: 'file', fileId: stored.id, name: 'plan.pdf', ext: 'pdf', sizeBytes: 2048 });
});

test('нормализация: alt, подпись и название обрезаются, пустые необязательные поля убираются', () => {
  const [img, file] = normalizeBlocks([
    { id: 'b1', type: 'image', fileId: stored.id, alt: '  схема  ', caption: '   ', width: 10, height: 20 },
    { id: 'b2', type: 'file', fileId: stored.id, label: '  ', name: 'plan.pdf', ext: 'pdf', sizeBytes: 5 },
  ]);
  assert.deepEqual(img, { id: 'b1', type: 'image', fileId: stored.id, alt: 'схема', width: 10, height: 20 });
  assert.ok(file && file.type === 'file' && !('label' in file));
});

test('проблемы файлов: тексты file_not_found и file_wrong_kind, подпись поля alt из переданных', () => {
  const t = (key: string) => key;
  const base = { path: ['ru', 'blocks', 0], code: 'custom', message: '' };
  assert.equal(describeIssue({ ...base, message: 'file_not_found' }, t), 'fileNotFound');
  assert.equal(describeIssue({ ...base, message: 'file_wrong_kind' }, t), 'fileWrongKind');
  const tt = (key: string, v?: Record<string, string | number>) => (v ? `${key}:${v.field}` : key);
  const empty = { path: ['ru', 'blocks', 0, 'alt'], code: 'too_small', message: 'x', type: 'string', minimum: 1 };
  assert.equal(describeIssue(empty, tt, { alt: 'Текст вместо изображения' }), 'required:Текст вместо изображения');
});

test('картинка и обложка не принимают документ: по имени до отправки и по ответу сервера', () => {
  assert.deepEqual(precheck({ name: 'memo.pdf', size: 1024 }, 'image', limits), { code: 'bad_type' });
  assert.deepEqual(precheck({ name: 'memo.DOCX', size: 1024 }, 'cover', limits), { code: 'bad_type' });
  assert.equal(precheck({ name: 'photo.jpeg', size: 1024 }, 'image', limits), null);
  assert.equal(precheck({ name: 'memo.pdf', size: 1024 }, 'file', limits), null);
  assert.equal(wrongKindByName('noext', 'image'), false);
  assert.equal(isWrongKind('image', { kind: 'document' }), true);
  assert.equal(isWrongKind('cover', { kind: 'image' }), false);
  assert.equal(isWrongKind('file', { kind: 'document' }), false);
});
