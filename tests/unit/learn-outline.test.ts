import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProgress, neighbours } from '../../src/lib/learn/outline';
import type { OutlineModule } from '../../src/lib/learn/types';

function mod(id: string, ...lessonIds: string[]): OutlineModule {
  return {
    id,
    title: { ru: id },
    lessons: lessonIds.map((l) => ({ id: l, slug: l, title: { ru: l }, durationMin: 10, moduleId: id })),
  };
}
const modules = [mod('m1', 'a', 'b'), mod('m2', 'c', 'd')];
const states = (p: ReturnType<typeof buildProgress>) => p.lessons.map((l) => `${l.id}:${l.state}`).join(' ');

test('свободный порядок: все непройденные доступны', () => {
  const p = buildProgress(modules, new Set(['b']), false);
  assert.equal(states(p), 'a:open b:done c:open d:open');
  assert.equal(p.next?.id, 'a');
  assert.deepEqual([p.done, p.total, p.pct, p.complete], [1, 4, 25, false]);
});

test('последовательный порядок: после первого непройденного — замок', () => {
  assert.equal(states(buildProgress(modules, new Set(), true)), 'a:open b:locked c:locked d:locked');
  assert.equal(states(buildProgress(modules, new Set(['a']), true)), 'a:done b:open c:locked d:locked');
  assert.equal(states(buildProgress(modules, new Set(['a', 'b']), true)), 'a:done b:done c:open d:locked');
});

test('последовательный порядок: пройденный урок после первого непройденного остаётся доступным', () => {
  const p = buildProgress(modules, new Set(['b']), true);
  assert.equal(states(p), 'a:open b:done c:locked d:locked');
});

test('полное прохождение: 100 %, next = null; 249/250 не округляется до 100', () => {
  const full = buildProgress(modules, new Set(['a', 'b', 'c', 'd']), true);
  assert.deepEqual([full.pct, full.complete, full.next], [100, true, null]);

  const ids = Array.from({ length: 250 }, (_, i) => `l${i}`);
  const big = buildProgress([mod('m', ...ids)], new Set(ids.slice(0, 249)), false);
  assert.deepEqual([big.done, big.pct, big.complete], [249, 99, false]);
});

test('пустой курс: 0 %, не завершён; прогресс по несуществующим урокам не считается', () => {
  const empty = buildProgress([], new Set(['ghost']), false);
  assert.deepEqual([empty.total, empty.done, empty.pct, empty.complete], [0, 0, 0, false]);
  const p = buildProgress(modules, new Set(['ghost', 'a']), false);
  assert.deepEqual([p.done, p.total], [1, 4]);
});

test('счётчики по модулям и соседние уроки', () => {
  const p = buildProgress(modules, new Set(['a', 'b', 'c']), false);
  assert.deepEqual(
    p.modules.map((m) => [m.id, m.done, m.durationMin]),
    [
      ['m1', 2, 20],
      ['m2', 1, 20],
    ],
  );
  assert.deepEqual(
    [neighbours(p, 'c').prev?.id, neighbours(p, 'c').next?.id],
    ['b', 'd'],
  );
  assert.equal(neighbours(p, 'a').prev, null);
  assert.equal(neighbours(p, 'd').next, null);
  assert.deepEqual(neighbours(p, 'zzz'), { prev: null, next: null });
});
