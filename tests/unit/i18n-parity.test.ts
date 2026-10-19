// Паритет сообщений ru ↔ kz: у каждого messages/ru/*.json есть kz-близнец
// с тем же деревом ключей и теми же ICU-аргументами ({name}, {count, plural…}).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'messages');
const LOCALES = ['ru', 'kz'] as const;

type Tree = { [key: string]: Tree | string };

function load(locale: string, file: string): Tree {
  return JSON.parse(readFileSync(join(ROOT, locale, file), 'utf8')) as Tree;
}

/** Плоский список путей листьев: 'a.b.c' → значение. */
function flatten(tree: Tree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, out);
    else out.set(path, String(value));
  }
  return out;
}

/** Имена ICU-аргументов верхнего уровня и rich-тегов: {name}, {count, plural, …}, <mark>. */
function icuArgs(message: string): string[] {
  const args = new Set<string>();
  for (const m of message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)) if (m[1]) args.add(m[1]);
  for (const m of message.matchAll(/<([A-Za-z][\w-]*)>/g)) if (m[1]) args.add(`<${m[1]}>`);
  return [...args].sort();
}

const files = (locale: string) =>
  existsSync(join(ROOT, locale))
    ? readdirSync(join(ROOT, locale))
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];

test('у каждого файла есть близнец в другой локали', () => {
  const [a, b] = LOCALES.map(files) as [string[], string[]];
  assert.ok(a.length > 0, 'нет ни одного messages/ru/*.json');
  assert.deepEqual(b, a, 'наборы файлов messages/ru и messages/kz различаются');
});

for (const file of files('ru')) {
  test(`${file}: одинаковые ключи ru и kz`, () => {
    const ru = flatten(load('ru', file));
    const kz = flatten(load('kz', file));
    const missing = [...ru.keys()].filter((k) => !kz.has(k));
    const extra = [...kz.keys()].filter((k) => !ru.has(k));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `kz/${file}: расхождение ключей`);
  });

  test(`${file}: нет пустых строк и совпадают ICU-аргументы`, () => {
    const ru = flatten(load('ru', file));
    const kz = flatten(load('kz', file));
    for (const [key, ruValue] of ru) {
      const kzValue = kz.get(key);
      if (kzValue === undefined) continue; // отчитается тест ключей
      assert.ok(ruValue.trim(), `ru/${file}: пустое значение ${key}`);
      assert.ok(kzValue.trim(), `kz/${file}: пустое значение ${key}`);
      assert.deepEqual(icuArgs(kzValue), icuArgs(ruValue), `${file}: разные аргументы в ${key}`);
    }
  });
}
