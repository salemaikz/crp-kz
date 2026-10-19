// Разбор готового PDF для тестов: распакованные потоки и символы из таблиц ToUnicode.
import { inflateSync } from 'node:zlib';

/** Исходные байты PDF и все потоки, которые удалось распаковать, одной строкой: для поиска текста. */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const parts = [raw];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      parts.push(inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'));
    } catch {
      /* поток без сжатия (картинка и т. п.) */
    }
  }
  return parts.join('\n');
}

/**
 * Символы, ушедшие в текст PDF: берутся из таблиц ToUnicode (pdfkit пишет их как
 * `beginbfrange <от> <до> [<символ> <символ> ...]`).
 */
export function unicodeInPdf(bytes: Uint8Array): Set<number> {
  const out = new Set<number>();
  for (const block of pdfText(bytes).matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const arr of block[1]!.matchAll(/\[([^\]]*)\]/g)) {
      for (const hex of arr[1]!.matchAll(/<([0-9a-fA-F]{4})>/g)) out.add(parseInt(hex[1]!, 16));
    }
  }
  return out;
}

/** Каждая буква (кроме пробельных) из строк должна попасть в текст PDF. */
export function missingChars(bytes: Uint8Array, ...texts: string[]): string[] {
  const have = unicodeInPdf(bytes);
  return [...new Set(Array.from(texts.join('')))].filter((ch) => !/\s/.test(ch) && !have.has(ch.codePointAt(0)!));
}
