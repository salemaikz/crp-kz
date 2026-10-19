// Даты без года для текущего года (колонка «Срок», список заказов) и склонения в отчёте команды.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDate } from '@/lib/format';

const NOW = Date.UTC(2026, 9, 19, 9, 0); // 19 октября 2026, Астана
const SAME_YEAR = Date.UTC(2026, 9, 24, 9, 0);
const NEXT_YEAR = Date.UTC(2027, 0, 15, 9, 0);

test('formatDate: поведение по умолчанию не меняется — год всегда есть', () => {
  assert.match(formatDate(SAME_YEAR, 'ru', { short: true }), /2026/);
  assert.match(formatDate(SAME_YEAR, 'ru'), /2026/);
});

test('formatDate: omitCurrentYear убирает год только у дат текущего года', () => {
  const same = formatDate(SAME_YEAR, 'ru', { short: true, omitCurrentYear: true, now: NOW });
  assert.doesNotMatch(same, /2026/);
  assert.match(same, /24/);
  assert.match(formatDate(NEXT_YEAR, 'ru', { short: true, omitCurrentYear: true, now: NOW }), /2027/);
});

test('formatDate: граница года считается по Астане, а не по UTC', () => {
  // 31 декабря 2026, 20:00 UTC = 1 января 2027, 01:00 в Астане
  const newYearAlmaty = Date.UTC(2026, 11, 31, 20, 0);
  assert.match(formatDate(newYearAlmaty, 'ru', { short: true, omitCurrentYear: true, now: NOW }), /2027/);
});

test('formatDate: работает для казахского (kk)', () => {
  assert.doesNotMatch(formatDate(SAME_YEAR, 'kz', { short: true, omitCurrentYear: true, now: NOW }), /2026/);
});

test('ru: «из N уроков/назначений» — родительный падеж по плюрализации', () => {
  const team = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'messages/ru/team.json'), 'utf8'));
  assert.equal(team.report.lessons, '{done} из {total, plural, one {# урока} other {# уроков}}');
  assert.equal(team.stats.completionHint, '{done} из {total, plural, one {# назначения} other {# назначений}}');
});
