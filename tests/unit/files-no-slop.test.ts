// «Без ИИ-шума» (D-023) для текстов загрузки файлов: messages/*/files.json без «!», стрелок и пустых строк.
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
  test(`files.json (${locale}): без восклицаний, стрелок и пустых строк`, () => {
    const tree = JSON.parse(readFileSync(join(ROOT, 'messages', locale, 'files.json'), 'utf8')) as unknown;
    const all = leaves(tree);
    assert.ok(all.length > 0);
    for (const [path, text] of all) {
      assert.ok(text.trim().length > 0, `${path}: пустая строка`);
      assert.ok(!text.includes('!'), `${path}: восклицательный знак`);
      assert.ok(!/[→←↗]/.test(text), `${path}: стрелка в тексте`);
    }
  });
}
