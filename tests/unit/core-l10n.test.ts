import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasLocale, htmlLang, t } from '../../src/lib/content/l10n';

test('t(): нужная локаль → ru → первая непустая', () => {
  assert.equal(t({ ru: 'Привет', kz: 'Сәлем' }, 'kz'), 'Сәлем');
  assert.equal(t({ ru: 'Привет', kz: 'Сәлем' }, 'ru'), 'Привет');
  assert.equal(t({ ru: 'Привет' }, 'kz'), 'Привет');
  assert.equal(t({ ru: 'Привет', kz: '   ' }, 'kz'), 'Привет');
  assert.equal(t({ ru: '', kz: 'Сәлем' }, 'ru'), 'Сәлем');
  assert.equal(t({ en: 'Hi' } as never, 'ru'), 'Hi');
});

test('t(): пустые и нестандартные значения', () => {
  assert.equal(t(null, 'ru'), '');
  assert.equal(t(undefined, 'kz'), '');
  assert.equal(t({}, 'ru'), '');
  assert.equal(t('строка', 'kz'), 'строка');
  assert.equal(t({ ru: 5, kz: 'x' } as never, 'ru'), 'x');
});

test('htmlLang: kz → kk (D-002)', () => {
  assert.equal(htmlLang('kz'), 'kk');
  assert.equal(htmlLang('ru'), 'ru');
});

test('hasLocale', () => {
  assert.equal(hasLocale({ ru: 'a' }, 'kz'), false);
  assert.equal(hasLocale({ ru: 'a', kz: 'b' }, 'kz'), true);
  assert.equal(hasLocale({ ru: 'a' }, 'ru'), true);
});
