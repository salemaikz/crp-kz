// Стиль v3 «без ИИ-шума» (D-023, BRAND.md): в коде не должно возвращаться то, что убрано.
// Тест простой: ищем запрещённые приёмы в src и сверяем копию токенов в docs/brand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, 'src'));
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(ROOT.length + 1);

/** Файлы, где встречается паттерн (комментарии тоже считаются: их лучше не оставлять). */
function find(pattern: RegExp): string[] {
  return files.filter((p) => pattern.test(read(p))).map(rel);
}

test('нет стекла, размытия и смешивания слоёв', () => {
  assert.deepEqual(find(/backdrop-filter|blur\(|mix-blend/), []);
});

test('нет рукописного шрифта и цветной тени кнопки', () => {
  assert.deepEqual(find(/font-hand|caveat|shadow-red/i), []);
});

test('удалённые компоненты не используются: Eyebrow, Hand, LinkArrow', () => {
  assert.deepEqual(find(/\bEyebrow\b|<Hand\b|\bLinkArrow\b|link-arrow/), []);
  for (const gone of ['Eyebrow', 'Hand', 'LinkArrow']) {
    assert.equal(existsSync(join(ROOT, 'src/components/ui', `${gone}.tsx`)), false, `${gone}.tsx должен быть удалён`);
  }
});

test('нет класса eyebrow и анимаций появления при прокрутке', () => {
  assert.deepEqual(find(/className="eyebrow|(^|\n)\s*\.eyebrow\b|\.reveal\b/), []);
});

test('шапка сплошная, а карточка и кнопка — без тени', () => {
  const tokens = read(join(ROOT, 'src/styles/tokens.css'));
  assert.match(tokens, /--header-bg:\s*var\(--deep\)/);
  const components = read(join(ROOT, 'src/styles/components.css'));
  const card = /\.card\s*\{[^}]*\}/.exec(components)?.[0] ?? '';
  assert.ok(card.includes('border: 1px solid var(--line)'));
  assert.ok(!/box-shadow/.test(card));
  const primary = /\.btn--primary\s*\{[^}]*\}/.exec(components)?.[0] ?? '';
  assert.ok(!/shadow/.test(primary));
});

test('токены в docs/brand совпадают с src/styles', () => {
  assert.equal(read(join(ROOT, 'docs/brand/tokens.css')), read(join(ROOT, 'src/styles/tokens.css')));
});
