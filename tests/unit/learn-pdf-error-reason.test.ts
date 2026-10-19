import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRenderError } from '../../src/lib/learn/pdf/errorReason';

test('системная ошибка Node: класс, code и первая строка message (до 200 символов)', () => {
  const e = Object.assign(new TypeError("ENOENT: no such file, open 'Helvetica.afm'\n  at stack"), { code: 'ENOENT' });
  assert.equal(describeRenderError(e), "error=TypeError, code=ENOENT, message=ENOENT: no such file, open 'Helvetica.afm'");
  const long = Object.assign(new Error('x'.repeat(500)), { code: 'EACCES' });
  assert.equal(describeRenderError(long).split('message=')[1]!.length, 200);
});

test('обычная ошибка: только класс, message не пишется (в нём могут быть ФИО и курс)', () => {
  const out = describeRenderError(new Error('bad glyph ӘЛИЯ ҚҰРМАНҒАЛИҚЫЗЫ / Бизнес-разбор'));
  assert.equal(out, 'error=Error');
});

test('code не из системных не пишется, message тоже', () => {
  const e = Object.assign(new Error('Әлия'), { code: 'Әлия' });
  assert.equal(describeRenderError(e), 'error=Error');
});

test('не Error: без деталей', () => {
  assert.equal(describeRenderError('Әлия'), 'error=non-Error');
});
