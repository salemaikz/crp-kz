import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedId } from '../../src/lib/content/ids';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('seedId: стабилен и имеет формат UUID v5', () => {
  const a = seedId('user', 'admin@crp.demo');
  assert.match(a, UUID_V5);
  assert.equal(seedId('user', 'admin@crp.demo'), a);
  // зафиксированное значение: смена алгоритма сломает сессии демо и ссылки — только осознанно
  assert.equal(a, SNAPSHOT);
});

test('seedId: разные пространство или ключ — разные id', () => {
  assert.notEqual(seedId('user', 'a'), seedId('user', 'b'));
  assert.notEqual(seedId('user', 'a'), seedId('org', 'a'));
});

const SNAPSHOT = 'cf75e21f-991d-51ed-9629-3709c65a6a1a';
