import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNoticeHiddenPath, pathWithoutLocale } from '../../src/components/account/HideOnPaths';

test('путь без языкового сегмента', () => {
  assert.equal(pathWithoutLocale('/ru/courses/x/buy'), '/courses/x/buy');
  assert.equal(pathWithoutLocale('/kz'), '/');
  assert.equal(pathWithoutLocale('/learn'), '/learn', 'трёхбуквенный сегмент — не язык');
});

test('плашка из layout скрыта на покупке и на /account/verify, на остальных страницах показана', () => {
  for (const p of ['/ru/courses/sales-doubling/buy', '/kz/courses/sales-doubling/buy/', '/ru/account/verify', '/kz/account/verify']) {
    assert.equal(isNoticeHiddenPath(p), true, p);
  }
  for (const p of ['/ru', '/ru/learn', '/ru/courses/sales-doubling', '/ru/courses/sales-doubling/buyer', '/ru/orders/CRP-1', '/ru/account/verify/x']) {
    assert.equal(isNoticeHiddenPath(p), false, p);
  }
});
