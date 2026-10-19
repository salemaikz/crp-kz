// pdfkit должен лежать в корне node_modules той версии, что закреплена в package.json:
// next.config.ts трассирует ./node_modules/pdfkit/js/standard-fonts/** для функции PDF.
// Если обновление любого @react-pdf/* (renderer, font) положит свою копию pdfkit во вложенный node_modules, корневой
// путь укажет не на тот пакет — на Netlify снова MODULE_NOT_FOUND, а локально всё зелёное.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));

// Корень пакета по его точке входа: package.json у pdfkit не открыт в exports.
function packageRoot(name: string, from?: string): string {
  let dir = path.dirname(require.resolve(name, from ? { paths: [from] } : undefined));
  while (!existsSync(path.join(dir, 'package.json')) || readJson(path.join(dir, 'package.json')).name !== name) {
    const up = path.dirname(dir);
    assert.notEqual(up, dir, `не найден корень пакета ${name}`);
    dir = up;
  }
  return dir;
}

function readJson(file: string): { name?: string; version?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('все @react-pdf/* с зависимостью pdfkit видят корневой pdfkit закреплённой версии', () => {
  const rootPdfkit = packageRoot('pdfkit');
  assert.equal(rootPdfkit, path.join(ROOT, 'node_modules', 'pdfkit'));
  const scope = path.join(ROOT, 'node_modules', '@react-pdf');
  const consumers = readdirSync(scope)
    .map((d) => path.join(scope, d))
    .filter((dir) => existsSync(path.join(dir, 'package.json')) && readJson(path.join(dir, 'package.json')).dependencies?.pdfkit);
  // renderer и font точно тянут pdfkit: font создаёт документ ради стандартных шрифтов
  for (const name of ['renderer', 'font']) assert.ok(consumers.includes(path.join(scope, name)), `@react-pdf/${name}`);
  for (const dir of consumers) {
    assert.equal(packageRoot('pdfkit', dir), rootPdfkit, `${path.basename(dir)} берёт вложенную копию pdfkit`);
  }
  const pinned = readJson(path.join(ROOT, 'package.json')).dependencies?.pdfkit;
  assert.equal(readJson(path.join(rootPdfkit, 'package.json')).version, pinned);
});
