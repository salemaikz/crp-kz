// «Без ИИ-шума» (D-023) для юридических документов: тексты, локали и стили.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
  test(`legal.json (${locale}): без стрелок, «N+», восклицаний и надписей-eyebrow`, () => {
    const tree = JSON.parse(readFileSync(join(ROOT, 'messages', locale, 'legal.json'), 'utf8')) as unknown;
    const all = leaves(tree);
    assert.ok(all.length > 20, 'legal.json пуст');
    for (const [path, text] of all) {
      assert.ok(!/[→←↗]/.test(text), `${path}: стрелка в тексте`);
      assert.ok(!/\d\+/.test(text), `${path}: «N+» в числе`);
      assert.ok(!text.includes('!'), `${path}: восклицательный знак`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${path}: эмодзи`);
      assert.ok(!/(^|\.)eyebrow$/.test(path), `${path}: надпись над заголовком`);
    }
  });
}

test('content/legal: без стрелок, восклицаний и эмодзи', () => {
  for (const dir of readdirSync(join(ROOT, 'content', 'legal'))) {
    for (const f of readdirSync(join(ROOT, 'content', 'legal', dir))) {
      const text = readFileSync(join(ROOT, 'content', 'legal', dir, f), 'utf8');
      assert.ok(!/[→←↗]/.test(text), `${dir}/${f}: стрелка`);
      assert.ok(!text.includes('!'), `${dir}/${f}: восклицательный знак`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${dir}/${f}: эмодзи`);
    }
  }
});

test('legal.css: без стекла, размытия, колец и свечения', () => {
  const css = readFileSync(join(ROOT, 'src/components/legal/legal.css'), 'utf8');
  for (const bad of ['backdrop-filter', 'blur(', 'mix-blend-mode', 'radial-gradient', '.circles', 'var(--shadow)', 'var(--shadow-lg)', 'box-shadow']) {
    assert.ok(!css.includes(bad), `в legal.css осталось: ${bad}`);
  }
});

test('подпись черновика не звучит как утверждённый текст', () => {
  for (const [locale, re] of [['ru', /не действует/], ['kz', /күші жоқ/]] as const) {
    const tree = JSON.parse(readFileSync(join(ROOT, 'messages', locale, 'legal.json'), 'utf8')) as { doc: { draft: string } };
    assert.match(tree.doc.draft, re);
  }
});
