// Предупреждение о слишком малом MAIL_RETENTION_DAYS: пишется один раз за процесс.
// Отдельный файл — чтобы модуль config был свежим и флаг «уже предупреждали» не сброшен чужими тестами.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mailRetentionDays, MIN_MAIL_RETENTION_DAYS } from '../../src/lib/mail/config';

test('меньше минимума: оба вызова дают 31, warn ровно один раз и только с числами дней', () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    assert.equal(mailRetentionDays({ MAIL_RETENTION_DAYS: '7' }), MIN_MAIL_RETENTION_DAYS);
    assert.equal(mailRetentionDays({ MAIL_RETENTION_DAYS: '7' }), 31);
    assert.equal(warn.mock.callCount(), 1);
    const text = warn.mock.calls[0]!.arguments.join(' ');
    // в тексте только заданное число и минимум (дважды), больше чисел нет
    assert.deepEqual(text.match(/\d+/g), ['7', '31', '31']);
  } finally {
    warn.mock.restore();
  }
});

test('значение не меньше минимума не пишет warn', () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    assert.equal(mailRetentionDays({ MAIL_RETENTION_DAYS: '45' }), 45);
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    warn.mock.restore();
  }
});
