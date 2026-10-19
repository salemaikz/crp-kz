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
const cssFiles = files.filter((p) => p.endsWith('.css'));
const tsxFiles = files.filter((p) => p.endsWith('.tsx'));
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(ROOT.length + 1);

/** Файлы, где встречается паттерн (комментарии тоже считаются: их лучше не оставлять). */
function find(pattern: RegExp, among: string[] = files): string[] {
  return among.filter((p) => pattern.test(read(p))).map(rel);
}

test('нет стекла, размытия и смешивания слоёв', () => {
  assert.deepEqual(find(/backdrop-filter|mix-blend/), []);
  // blur( без буквы перед ним: onBlur и .blur() не считаются
  assert.deepEqual(find(/(?<![A-Za-z])blur\(/, [...cssFiles, ...tsxFiles]), []);
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
  assert.deepEqual(find(/['"\s]eyebrow['"\s]|\.eyebrow\b/, [...cssFiles, ...tsxFiles]), []);
  assert.deepEqual(find(/\.reveal\b/), []);
});

test('шапка сплошная, а карточка и кнопка — без тени', () => {
  const tokens = read(join(ROOT, 'src/styles/tokens.css'));
  assert.match(tokens, /--header-bg:\s*var\(--deep\)/);
  const components = read(join(ROOT, 'src/styles/components.css'));
  const card = /\.card\s*\{[^}]*\}/.exec(components)?.[0] ?? '';
  assert.ok(card.includes('border: 1px solid var(--line)'));
  assert.ok(!/box-shadow/.test(card));
  // тени нет ни в одном блоке .btn--primary (включая :hover и составные селекторы)
  const primaryBlocks = components.match(/\.btn--primary[^{]*\{[^}]*\}/g) ?? [];
  assert.ok(primaryBlocks.length > 0, 'блоки .btn--primary не найдены');
  for (const block of primaryBlocks) assert.ok(!/shadow/.test(block), block);
});

test('маркер и кольца — только на главной, статичные', () => {
  // `<Mark\b` не ловит <Markdown: после «Mark» идёт буква, границы слова нет
  assert.deepEqual(find(/<Mark\b/, tsxFiles), ['src/components/catalog/home/HomeHero.tsx']);
  const allowedCircles = ['src/components/catalog/home/HomeHero.tsx', 'src/components/catalog/home/HomeSections.tsx'];
  for (const f of find(/<Circles\b/, tsxFiles)) assert.ok(allowedCircles.includes(f), `${f}: кольца вне главной`);
  assert.deepEqual(find(/mark-draw|ring-in/), []);
});

test('токены в docs/brand совпадают с src/styles', () => {
  assert.equal(read(join(ROOT, 'docs/brand/tokens.css')), read(join(ROOT, 'src/styles/tokens.css')));
});
