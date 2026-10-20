// Репозиторий публичный: в deploy/ и docs/ops/ не должно быть IP, ключей и паролей (ops §5, угроза 1).
// Шаблоны env задают значения только в угловых скобках, например <пароль-crp_app>.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Адреса, которые допустимы как примеры: петля, «любой» и диапазоны для документации (RFC 5737).
const SAFE_IPV4 = [/^127\.0\.0\.1$/, /^0\.0\.0\.0$/, /^192\.0\.2\.\d+$/, /^198\.51\.100\.\d+$/, /^203\.0\.113\.\d+$/];

/** Находки в тексте: человекочитаемые причины без самих значений. */
function scanText(text: string, kind: 'env' | 'other' = 'env'): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g)) {
    const ip = m[1] ?? '';
    const octets = ip.split('.').map(Number);
    if (octets.every((o) => o <= 255) && !SAFE_IPV4.some((re) => re.test(ip))) found.push('ipv4');
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) found.push('private-key');
  if (/AGE-SECRET-KEY-/.test(text)) found.push('age-secret-key');
  // postgres://пользователь:пароль@хост, где пароль не заглушка в угловых скобках
  for (const m of text.matchAll(/postgres(?:ql)?:\/\/[^:@\s/]+:([^@\s]*)@/g)) {
    if (!/^<[^<>]+>$/.test(m[1] ?? '')) found.push('db-password');
  }
  // токен Telegram-бота: <цифры>:<35 символов>
  if (/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/.test(text)) found.push('telegram-token');
  // длинные base64-строки как значения секретов в KEY=VALUE
  // (только шаблоны env и документы: в shell-скриптах такие имена - переменные, а не значения; флаги 0 и 1 - не секрет)
  if (kind === 'env') {
    for (const m of text.matchAll(/^[A-Z][A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*=(.+)$/gm)) {
      const v = (m[1] ?? '').trim();
      if (!/^<[^<>]+>$/.test(v) && !/^[01]$/.test(v)) found.push('secret-value');
    }
  }
  return found;
}

const files = [...walk(join(ROOT, 'deploy')), ...walk(join(ROOT, 'docs', 'ops'))];

test('есть что сканировать', () => {
  assert.ok(files.length >= 15, `найдено файлов: ${files.length}`);
});

test('в deploy/ и docs/ops/ нет IP, ключей и паролей', () => {
  const bad: string[] = [];
  for (const f of files) {
    const reasons = scanText(readFileSync(f, 'utf8'), /\.(example|md)$/.test(f) ? 'env' : 'other');
    if (reasons.length) bad.push(`${relative(ROOT, f)}: ${[...new Set(reasons)].join(', ')}`);
  }
  assert.deepEqual(bad, []);
});

test('в deploy/ и docs/ops/ нет абсолютных путей локальной машины', () => {
  const bad = files.filter((f) => /\/(?:home|Users)\/[a-z0-9_-]+\//i.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
  assert.deepEqual(bad, []);
});

test('сканер видит нарушения (проверка самого теста)', () => {
  const ip = ['203', '0', '114', '9'].join('.');
  assert.deepEqual(scanText(`host ${ip}`), ['ipv4']);
  assert.deepEqual(scanText('host 127.0.0.1 и 203.0.113.7 и 0.0.0.0/0'), []);
  assert.deepEqual(scanText('версия 22.20.5 и 1.2.3'), []);
  assert.deepEqual(scanText(`-----BEGIN ${'OPENSSH'} PRIVATE KEY-----`), ['private-key']);
  assert.deepEqual(scanText(`${'AGE-SECRET-KEY-'}1ABC`), ['age-secret-key']);
  assert.deepEqual(scanText('DATABASE_URL=postgres://crp_app:realpass@127.0.0.1:5432/crp'), ['db-password']);
  assert.deepEqual(scanText('DATABASE_URL=postgres://crp_app:<пароль-crp_app>@127.0.0.1:5432/crp'), []);
  assert.deepEqual(scanText('SESSION_SECRET=abcdefghijklmnop'), ['secret-value']);
  assert.deepEqual(scanText('SESSION_SECRET=<openssl-rand-base64-48>\nSESSION_SECRET='), []);
  assert.deepEqual(scanText(`ALERT_TELEGRAM_BOT_TOKEN=${'123456789'}:${'A'.repeat(35)}`), ['telegram-token', 'secret-value']);
});
