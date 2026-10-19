// Админка без ИИ-шума (D-023, BRAND.md): рабочий инструмент — плоские рамки, без теней, градиентов,
// надписей над заголовками и стрелок в ссылках. Тест страхует от возврата этих приёмов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const adminFiles = [...walk(join(ROOT, 'src/components/admin')), ...walk(join(ROOT, 'src/app/[locale]/admin'))];

test('в CSS админки нет теней, градиентов, стекла', () => {
  const css = read(join(ROOT, 'src/components/admin/admin.css'));
  assert.doesNotMatch(css, /box-shadow|gradient\(|backdrop-filter|blur\(|--shadow/);
  assert.doesNotMatch(css, /--hero-bg|circles|rings/);
});

test('в коде админки нет стрелок «вперёд/назад» и надписей над заголовками', () => {
  for (const file of adminFiles.filter((f) => f.endsWith('.tsx'))) {
    const src = read(file);
    const rel = file.slice(ROOT.length + 1);
    assert.doesNotMatch(src, /ArrowRight|ArrowLeft|eyebrow|<Circles|<Mark\b/, rel);
  }
});

test('в админке нет декоративных классов под удалённые элементы', () => {
  const css = read(join(ROOT, 'src/components/admin/admin.css'));
  for (const gone of ['adm-quick', 'adm-dash', 'adm-stat__icon', 'adm-feed__icon', 'adm-addblock__plus']) {
    assert.ok(!css.includes(gone), `${gone} должен быть удалён`);
  }
});

test('тексты админки: нет лозунгов-заголовков и «не X, а Y»', () => {
  for (const locale of ['ru', 'kz']) {
    const json = read(join(ROOT, `messages/${locale}/admin.json`));
    assert.doesNotMatch(json, /Что на платформе|Быстрые действия|Жылдам әрекеттер|Платформада бүгін/, locale);
  }
});

test('панель сохранения урока — не плавающая плашка: у низа окна, без скругления', () => {
  const css = read(join(ROOT, 'src/components/admin/admin.css'));
  const bar = /\.adm-savebar \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(bar, /bottom:\s*0/);
  assert.doesNotMatch(bar, /border-radius/);
  assert.match(bar, /border-top/);
});

test('аннулированный счёт: плашка без поворота и прозрачности', () => {
  const css = read(join(ROOT, 'src/components/checkout/checkout.css'));
  const stamp = /\.co-stamp \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(stamp, /border:\s*2px solid var\(--error\)/);
  assert.doesNotMatch(stamp, /rotate|opacity|position:\s*absolute/);
});

test('пустые состояния в админке, заказах и команде — без декоративных иконок', () => {
  const files = [
    ...adminFiles.filter((f) => f.endsWith('.tsx')),
    ...walk(join(ROOT, 'src/app/[locale]/orders')),
    ...walk(join(ROOT, 'src/components/team')),
  ];
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /<EmptyState[^>]*\sicon=/, file.slice(ROOT.length + 1));
    assert.doesNotMatch(src, /<EmptyState\s*\n(?:[^>]*\n)*?\s+icon=/, file.slice(ROOT.length + 1));
  }
});

test('список заказов: подтверждение без фиксированной ширины, колонка действий не переносится', () => {
  const css = read(join(ROOT, 'src/components/checkout/checkout.css'));
  assert.doesNotMatch(css, /196px/);
  assert.match(css, /\.co-orders \.table :is\(th, td\):last-child \{[^}]*white-space:\s*nowrap/);
});

test('таблица заказов: без отдельных колонок даты и способа оплаты (они под номером и суммой)', () => {
  const src = read(join(ROOT, 'src/app/[locale]/admin/orders/page.tsx'));
  assert.doesNotMatch(src, /key: 'date'|key: 'method'/);
});
