import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRenderError } from '../../src/lib/learn/pdf/errorReason';

const input = { holderName: 'Әлия Құрманғалиқызы', courseTitle: 'Бизнес-разбор' };

test('класс, code и первая строка message; остальные строки не попадают', () => {
  const e = Object.assign(new TypeError("ENOENT: no such file, open 'Helvetica.afm'\n  at stack"), { code: 'ENOENT' });
  assert.equal(describeRenderError(e, input), "error=TypeError, code=ENOENT, message=ENOENT: no such file, open 'Helvetica.afm'");
});

test('message обрезается до 200 символов', () => {
  const out = describeRenderError(new Error('x'.repeat(500)), input);
  assert.equal(out.split('message=')[1]!.length, 200);
});

test('ФИО и название курса вырезаются из message целиком и по словам', () => {
  const out = describeRenderError(new Error('bad glyph in Әлия Құрманғалиқызы / Бизнес-разбор / құрманғалиқызы'), input);
  assert.ok(!/Әлия|Құрман|құрман|Бизнес/.test(out), out);
});

test('не Error: без деталей', () => {
  assert.equal(describeRenderError('Әлия', input), 'error=non-Error');
});
