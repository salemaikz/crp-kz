// «Без ИИ-шума» (D-023) для обучения: в текстах learn нет стрелок и «N+», в стилях — стекла, колец и свечения.
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

function listSource(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listSource(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

test('пустые состояния в зоне learn/cert — без декоративных иконок', () => {
  const files = [
    ...listSource(join(ROOT, 'src/components/learn')),
    ...listSource(join(ROOT, 'src/app/[locale]/learn')),
    ...listSource(join(ROOT, 'src/app/[locale]/cert')),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/<EmptyState[^>]*\sicon=/s.test(src), `${f}: у EmptyState передана иконка`);
  }
});

test('выноска success несёт значок: статус не держится только на цвете', () => {
  const src = readFileSync(join(ROOT, 'src/components/learn/Callout.tsx'), 'utf8');
  assert.ok(/tone === 'success'[^\n]*CircleCheck/.test(src), 'у success нет CircleCheck');
});

test('боковая программа урока прокручивается внутри карточки', () => {
  const css = readFileSync(join(ROOT, 'src/components/learn/learn.css'), 'utf8');
  assert.match(css, /\.lrn-aside \.lrn-outline\s*\{[^}]*overflow-y:\s*auto/);
});

const flat = (locale: string) =>
  new Map(leaves(JSON.parse(readFileSync(join(ROOT, 'messages', locale, 'learn.json'), 'utf8')) as unknown));

for (const locale of ['ru', 'kz']) {
  test(`learn.json (${locale}): тексты после проверки`, () => {
    const m = flat(locale);
    assert.ok(!/Отлично|Тамаша/.test(m.get('quiz.passedText') ?? ''), 'в результате теста нет похвалы');
    assert.ok(!m.has('actions.skip'), 'ключ actions.skip убран: «Следующий урок» — actions.next');
    assert.ok(!m.has('verify.valid.seal'), 'плашка seal убрана: подлинность уже в заголовке');
    assert.match(m.get('card.nextUp') ?? '', /\{title\}/);
    for (const key of ['state.done', 'lesson.positionFirst']) {
      const text = m.get(key) ?? '';
      assert.ok(text !== '' && text.startsWith(text.charAt(0).toUpperCase()), `${key}: с заглавной`);
    }
  });
}
