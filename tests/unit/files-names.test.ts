// Имена файлов: sanitizeFileName и contentDisposition.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentDisposition, sanitizeFileName } from '../../src/lib/storage/names';

test('sanitizeFileName: расширение берётся из сигнатуры', () => {
  assert.equal(sanitizeFileName('Отчёт.PDF.exe', 'pdf'), 'Отчёт.PDF.pdf');
  assert.equal(sanitizeFileName('photo.jpeg', 'jpg'), 'photo.jpg');
  assert.equal(sanitizeFileName('без расширения', 'docx'), 'без расширения.docx');
});

test('sanitizeFileName: путь, управляющие символы, RTLO, кавычки', () => {
  assert.equal(sanitizeFileName('../../etc/passwd', 'pdf'), 'passwd.pdf');
  assert.equal(sanitizeFileName('C:\\x\\y.pdf', 'pdf'), 'y.pdf');
  assert.equal(sanitizeFileName('a\u0000b\r\nc.pdf', 'pdf'), 'abc.pdf');
  assert.equal(sanitizeFileName('doc\u202Efdp.exe', 'pdf'), 'docfdp.pdf');
  assert.equal(sanitizeFileName('"a"<b>|c?*.pdf', 'pdf'), 'abc.pdf');
});

test('sanitizeFileName: длина, пустое имя, только точки', () => {
  const long = sanitizeFileName('я'.repeat(300) + '.pdf', 'pdf');
  assert.equal(Array.from(long).length, 120 + '.pdf'.length);
  assert.equal(sanitizeFileName('', 'xlsx'), 'file.xlsx');
  assert.equal(sanitizeFileName('...', 'png'), 'file.png');
  assert.equal(sanitizeFileName('   .pdf', 'pdf'), 'file.pdf');
  assert.equal(sanitizeFileName('  много   пробелов  .pdf', 'pdf'), 'много пробелов.pdf');
});

test('contentDisposition: кириллица в filename*, ASCII-запасное имя, без CR/LF', () => {
  const v = contentDisposition('document', 'Отчёт 2026.pdf');
  assert.match(v, /^attachment; filename="[\x20-\x7E]+"; filename\*=UTF-8''/);
  assert.ok(v.includes("filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82%202026.pdf"));
  assert.ok(v.includes('filename="_____ 2026.pdf"'));
  assert.equal(/[\r\n]/.test(contentDisposition('document', 'a\r\nSet-Cookie: x=1.pdf')), false);
  assert.ok(/^[\x20-\x7E]+$/.test(contentDisposition('image', 'ы"\'()*.png')));
});

test('contentDisposition: attachment для документов, inline для изображений', () => {
  assert.ok(contentDisposition('document', 'a.pdf').startsWith('attachment;'));
  assert.ok(contentDisposition('image', 'a.png').startsWith('inline;'));
  const quoted = contentDisposition('document', 'a"b\\c.pdf');
  assert.ok(quoted.includes('filename="a_b_c.pdf"'));
});
