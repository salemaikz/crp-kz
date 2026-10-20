// Ключ блокировки квоты загрузки (D-034) лежит в общем реестре и не пересекается с остальными.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as locks from '../../src/lib/db/locks';

test('UPLOAD_QUOTA_LOCK_KEY есть в src/lib/db/locks.ts и уникален среди всех ключей', () => {
  assert.equal(typeof locks.UPLOAD_QUOTA_LOCK_KEY, 'number');
  assert.ok(Number.isSafeInteger(locks.UPLOAD_QUOTA_LOCK_KEY));
  const same = Object.entries(locks).filter(([, v]) => v === locks.UPLOAD_QUOTA_LOCK_KEY);
  assert.equal(same.length, 1);
  const values = Object.values(locks);
  assert.equal(new Set(values).size, values.length);
});
