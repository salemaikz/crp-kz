// Воркер почты: расписание повторов и очистка текста ошибки (без БД).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ATTEMPTS, nextAfterFailure, RETRY_DELAYS_MS, sanitizeError } from '../../src/lib/mail/worker';

const T = 1_800_000_000_000;
const MIN = 60_000;

test('расписание: 1 мин, 5 мин, 30 мин, 2 ч; всего 5 попыток', () => {
  assert.deepEqual([...RETRY_DELAYS_MS], [MIN, 5 * MIN, 30 * MIN, 120 * MIN]);
  assert.equal(MAX_ATTEMPTS, 5);
});

test('после 1–4 ошибки письмо возвращается в очередь с нужной паузой', () => {
  [MIN, 5 * MIN, 30 * MIN, 120 * MIN].forEach((delay, i) => {
    assert.deepEqual(nextAfterFailure(i + 1, T), { status: 'queued', nextAttemptAt: T + delay });
  });
});

test('пятая ошибка — окончательный отказ; больше пяти — тоже', () => {
  assert.deepEqual(nextAfterFailure(5, T), { status: 'failed' });
  assert.deepEqual(nextAfterFailure(7, T), { status: 'failed' });
});

test('текст ошибки: адреса и длинные токены вырезаются, длина не больше 500', () => {
  const out = sanitizeError(new Error('550 rejected <ivan.petrov@example.kz> token A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'));
  assert.ok(!out.includes('@'));
  assert.ok(!out.includes('A1b2C3d4'));
  assert.ok(out.includes('[email]'));
  assert.ok(sanitizeError(new Error('слово '.repeat(400))).length <= 500);
  assert.equal(sanitizeError('строка'), 'строка');
});
