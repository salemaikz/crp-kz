// Нормализация и хэш исходников юридических документов. Чистые функции, без fs.
import { createHash } from 'node:crypto';

/**
 * Нормализация перед хэшем: без BOM, переводы строк \n, Unicode NFC, без пробелов в конце
 * строк, ровно один \n в конце файла.
 */
export function normalizeLegalSource(raw: string): string {
  const text = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
  return `${text}\n`;
}

/** SHA-256 (hex) от UTF-8 нормализованного текста. */
export function legalSha256(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Первая строка «# Заголовок» отделяется от тела; тело — без ведущих пустых строк. */
export function splitTitle(normalized: string): { title: string; body: string } {
  const nl = normalized.indexOf('\n');
  const first = nl === -1 ? normalized : normalized.slice(0, nl);
  if (!first.startsWith('# ') || first.slice(2).trim() === '') {
    throw new Error('Юридический текст должен начинаться со строки «# Заголовок»');
  }
  const body = nl === -1 ? '' : normalized.slice(nl + 1).replace(/^\n+/, '');
  return { title: first.slice(2).trim(), body };
}
