import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHashParams } from '../../src/components/account/hashParams';

test('hash с «#» и без разбирается в параметры', () => {
  assert.equal(parseHashParams('#token=abc&next=%2Flearn', null).get('token'), 'abc');
  assert.equal(parseHashParams('token=abc&next=%2Flearn', null).get('next'), '/learn');
});

test('повторный запуск эффекта с пустым hash не затирает прочитанный токен', () => {
  const first = parseHashParams('#token=abc', null);
  assert.equal(parseHashParams('', first).get('token'), 'abc');
  assert.equal(parseHashParams('#', first).get('token'), 'abc');
});

test('пустой hash без прежнего значения — пустые параметры, не null', () => {
  const p = parseHashParams('', null);
  assert.equal(p.get('token'), null);
  assert.equal([...p].length, 0);
});

test('новый непустой hash заменяет прежний', () => {
  assert.equal(parseHashParams('#token=new', parseHashParams('#token=old', null)).get('token'), 'new');
});
