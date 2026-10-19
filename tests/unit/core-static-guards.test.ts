// Статические границы кода: проверяются чтением исходников.
// 1) files/url.ts без импортов (его берёт браузер); 2) клиентские файлы не тянут серверные модули;
// 3) в журнал пишет только writeAudit (D-026).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const srcFiles = walk(path.join(ROOT, 'src'));

test('src/lib/files/url.ts не содержит import', () => {
  const text = readFileSync(path.join(ROOT, 'src/lib/files/url.ts'), 'utf8');
  assert.equal(/^\s*import\s/m.test(text), false);
  assert.equal(/\brequire\(/.test(text), false);
});

// Хвост пути, по которому узнаём серверный модуль.
const SERVER_ONLY = [/(^|\/)features$/, /(^|\/)env$/, /(^|\/)mail\/config$/, /(^|\/)legal\/registry$/, /(^|\/)db(\/.*)?$/];

test('клиентские файлы не импортируют серверные модули напрямую', () => {
  const bad: string[] = [];
  for (const file of srcFiles) {
    const text = readFileSync(file, 'utf8');
    if (!/^\s*(['"])use client\1/m.test(text.split('\n').slice(0, 8).join('\n'))) continue;
    for (const m of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1]!;
      if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;
      if (SERVER_ONLY.some((re) => re.test(spec))) bad.push(`${rel(file)} → ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('INSERT INTO audit_log — только в src/lib/audit.ts (и сиде демо-данных)', () => {
  const ALLOWED = new Set(['src/lib/audit.ts', 'src/lib/db/seed/activity.ts']);
  const found = srcFiles
    .filter((f) => !ALLOWED.has(rel(f)))
    .filter((f) => /INSERT\s+INTO\s+audit_log/i.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(found, []);
});
