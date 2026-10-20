import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isJsonParam, jsonParam } from '../../src/lib/db/core';

test('jsonb-параметр опознаётся по бренду, а не по классу (копии core.ts в разных бандлах)', () => {
  assert.equal(isJsonParam(jsonParam({ a: 1 })), true);
  // «чужая» копия класса: другой конструктор, тот же глобальный бренд
  class Foreign {
    value: unknown;
    constructor(value: unknown) {
      this.value = value;
      (this as Record<symbol, unknown>)[Symbol.for('crp.jsonParam')] = true;
    }
  }
  assert.equal(isJsonParam(new Foreign({ a: 1 })), true);
  assert.equal(isJsonParam({ value: 1 }), false);
  assert.equal(isJsonParam(null), false);
  assert.equal(isJsonParam('x'), false);
});
