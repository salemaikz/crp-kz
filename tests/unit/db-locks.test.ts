// Ключи advisory-блокировок не пересекаются.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as locks from '../../src/lib/db/locks';

test('значения ключей блокировок уникальны', () => {
  const values = Object.values(locks);
  assert.ok(values.length >= 2);
  assert.equal(new Set(values).size, values.length);
  for (const v of values) assert.ok(Number.isSafeInteger(v));
});
