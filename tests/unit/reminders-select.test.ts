// Напоминания: чистый выбор получателей и ключ недели.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoWeekKey, OVERDUE_WINDOW_MS, selectLearnerReminders } from '../../src/lib/reminders/select';
import type { TeamReportRow, TeamRowStatus } from '../../src/lib/team/types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-20T10:00:00+05:00');

function row(over: Partial<TeamReportRow> & { key: string }): TeamReportRow {
  return {
    userId: 'u',
    name: 'Имя',
    email: 'u@x.kz',
    position: null,
    courseId: 'c',
    courseSlug: 'c',
    courseTitle: { ru: 'Курс' },
    source: 'assignment',
    lessonsDone: 0,
    lessonsTotal: 4,
    progress: 0,
    quizScore: null,
    quizzesAttempted: 0,
    quizzesPassed: 0,
    dueAt: NOW + DAY,
    status: 'soon',
    certificate: null,
    ...over,
  };
}

test('today и soon дают due_soon, overdue в окне 30 дней — overdue, ключ содержит срок', () => {
  const rows = [
    row({ key: 'a', status: 'today', dueAt: NOW + 3600_000 }),
    row({ key: 'b', status: 'soon', dueAt: NOW + 2 * DAY }),
    row({ key: 'c', status: 'overdue', dueAt: NOW - 3 * DAY }),
  ];
  const out = selectLearnerReminders(rows, NOW);
  assert.deepEqual(
    out.map((r) => [r.kind, r.dedupeKey]),
    [
      ['due_soon', `due_soon:a:${NOW + 3600_000}`],
      ['due_soon', `due_soon:b:${NOW + 2 * DAY}`],
      ['overdue', `overdue:c:${NOW - 3 * DAY}`],
    ],
  );
});

test('просрочка ровно 30 дней ещё шлётся, 31 день — нет', () => {
  const edge = row({ key: 'e', status: 'overdue', dueAt: NOW - OVERDUE_WINDOW_MS });
  const old = row({ key: 'o', status: 'overdue', dueAt: NOW - OVERDUE_WINDOW_MS - DAY });
  assert.deepEqual(selectLearnerReminders([edge, old], NOW).map((r) => r.row.key), ['e']);
});

test('завершённые, с закрытым доступом, без срока и далёкий срок напоминаний не дают', () => {
  const closed: TeamRowStatus[] = ['done', 'revoked', 'expired', 'nodue', 'ok'];
  const rows = closed.map((status, i) => row({ key: `k${i}`, status, dueAt: status === 'nodue' ? null : NOW + 10 * DAY }));
  assert.deepEqual(selectLearnerReminders(rows, NOW), []);
});

test('только назначения: покупка, выдача и самозапись не напоминаются', () => {
  const rows = ['purchase', 'grant', 'self', 'seat'].map((source, i) => row({ key: `s${i}`, source, status: 'overdue', dueAt: NOW - DAY }));
  assert.deepEqual(selectLearnerReminders(rows, NOW), []);
});

test('срок null при статусе overdue не ломает выбор', () => {
  assert.deepEqual(selectLearnerReminders([row({ key: 'x', status: 'overdue', dueAt: null })], NOW), []);
});

test('isoWeekKey: воскресенье 23:30 и понедельник 00:30 по Астане — разные недели', () => {
  assert.equal(isoWeekKey(Date.parse('2026-10-19T09:00:00+05:00')), '2026-W43');
  assert.equal(isoWeekKey(Date.parse('2026-10-25T23:30:00+05:00')), '2026-W43');
  assert.equal(isoWeekKey(Date.parse('2026-10-26T00:30:00+05:00')), '2026-W44');
});

test('isoWeekKey: время считается по Астане, а не по UTC', () => {
  // 2026-10-25 19:30 UTC — уже понедельник 26-го по Астане
  assert.equal(isoWeekKey(Date.parse('2026-10-25T19:30:00Z')), '2026-W44');
  assert.equal(isoWeekKey(Date.parse('2026-10-25T18:30:00Z')), '2026-W43');
});

test('isoWeekKey: граница года', () => {
  assert.equal(isoWeekKey(Date.parse('2026-12-31T12:00:00+05:00')), '2026-W53');
  assert.equal(isoWeekKey(Date.parse('2027-01-01T12:00:00+05:00')), '2026-W53');
  assert.equal(isoWeekKey(Date.parse('2027-01-04T12:00:00+05:00')), '2027-W01');
  assert.equal(isoWeekKey(Date.parse('2024-12-30T12:00:00+05:00')), '2025-W01');
});
