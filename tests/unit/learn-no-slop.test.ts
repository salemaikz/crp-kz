// «Без ИИ-шума» (D-023) для обучения: в текстах learn нет стрелок и «N+», в стилях — стекла, колец и свечения.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

function leaves(value: unknown, path = '', out: Array<[string, string]> = []): Array<[string, string]> {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  } else {
    out.push([path, String(value)]);
  }
  return out;
}

for (const locale of ['ru', 'kz']) {
  test(`learn.json (${locale}): без стрелок, «N+» и надписей-eyebrow`, () => {
    const tree = JSON.parse(readFileSync(join(ROOT, 'messages', locale, 'learn.json'), 'utf8')) as unknown;
    for (const [path, text] of leaves(tree)) {
      assert.ok(!/[→←↗]/.test(text), `${path}: стрелка в тексте`);
      assert.ok(!/\d\+/.test(text), `${path}: «N+» в числе`);
      assert.ok(!/(^|\.)eyebrow$/.test(path), `${path}: надпись над заголовком`);
    }
  });
}

test('learn.css: без стекла, размытия, колец и свечения', () => {
  const css = readFileSync(join(ROOT, 'src/components/learn/learn.css'), 'utf8');
  for (const bad of ['backdrop-filter', 'blur(', 'mix-blend-mode', 'radial-gradient', 'repeating-radial-gradient', '.circles', 'var(--shadow)', 'var(--shadow-lg)']) {
    assert.ok(!css.includes(bad), `в learn.css осталось: ${bad}`);
  }
});
