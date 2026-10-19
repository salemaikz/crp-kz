// migrate() вызывают только разрешённые файлы (К-12): остальным место в prepareDb(),
// иначе в production скрипт пойдёт в DDL от роли приложения и упадёт на правах.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..', '..');
const ALLOWED = new Set([
  'src/lib/db/migrate.ts', // определение
  'src/lib/db/index.ts', // prepareDb
  'src/lib/db/testing.ts', // тестовая БД
  'scripts/db-migrate.ts',
  'scripts/db-seed.ts',
  'scripts/build-demo-snapshot.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

test('вызов migrate( — только в разрешённых файлах', () => {
  const found: string[] = [];
  for (const dir of ['src', 'scripts']) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      // комментарии не считаем
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // вызов (в т.ч. «migrate (»), импорт символа migrate (в т.ч. с псевдонимом) и передача как значения
      const call = /(?<![\w.])migrate\s*\(/.test(code);
      const imp = /import\s*(?:type\s*)?\{[^}]*\bmigrate\b[^}]*\}\s*from\s*['"][^'"]*\/migrate['"]/.test(code);
      const ref = /\.then\(\s*migrate\s*[,)]/.test(code);
      const dyn = /\{[^}]*\bmigrate\b[^}]*\}\s*=\s*await\s+import\(/.test(code);
      if (call || imp || ref || dyn) found.push(rel);
    }
  }
  const unexpected = found.filter((f) => !ALLOWED.has(f));
  assert.deepEqual(unexpected, [], 'вызывайте prepareDb(db), а не migrate(db)');
  assert.ok(found.includes('src/lib/db/index.ts'), 'сканер видит вызовы (prepareDb)');
});
