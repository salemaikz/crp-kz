// Нормализация, хэш и разбор заголовка юридических текстов.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legalSha256, normalizeLegalSource, splitTitle } from '../../src/lib/legal/source';

test('нормализация: BOM, CRLF и CR, хвостовые пробелы, ровно один \\n', () => {
  assert.equal(normalizeLegalSource('﻿# А\r\nб  \rв\t\n\n\n'), '# А\nб\nв\n');
  assert.equal(normalizeLegalSource('# А'), '# А\n');
  assert.equal(normalizeLegalSource('# А\n'), '# А\n');
});

test('нормализация: Unicode NFC (й как и + U+0306 становится U+0439)', () => {
  const decomposed = '# й';
  assert.notEqual(decomposed, '# й');
  assert.equal(normalizeLegalSource(decomposed), '# й\n');
});

test('хэш стабилен и не зависит от формы записи переводов строк', () => {
  const a = legalSha256(normalizeLegalSource('# Т\n\nтекст\n'));
  const b = legalSha256(normalizeLegalSource('# Т\r\n\r\nтекст\r\n\r\n'));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, legalSha256(normalizeLegalSource('# Т\n\nтекст!\n')));
});

test('splitTitle: заголовок и тело без ведущих пустых строк', () => {
  assert.deepEqual(splitTitle('# Оферта\n\n## 1. Термины\nтекст\n'), { title: 'Оферта', body: '## 1. Термины\nтекст\n' });
  assert.deepEqual(splitTitle('# Только заголовок\n'), { title: 'Только заголовок', body: '' });
});

test('splitTitle: нет «# » в первой строке — ошибка', () => {
  for (const bad of ['Оферта\n', '## Оферта\n', '#Оферта\n', '# \n', '\n# Оферта\n', '']) {
    assert.throws(() => splitTitle(bad), Error, JSON.stringify(bad));
  }
});
