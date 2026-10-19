// Чистые функции вёрстки PDF сертификата: размеры шрифтов по длине текста и очистка строк.

/** Размер ФИО в pt: чем длиннее имя, тем мельче, чтобы оно умещалось в 2–3 строки. */
export function nameFontSize(name: string): number {
  const n = Array.from(name).length;
  if (n > 60) return 26;
  if (n > 40) return 32;
  if (n > 28) return 38;
  return 47;
}

/** Размер названия курса в pt. */
export function courseFontSize(title: string): number {
  const n = Array.from(title).length;
  if (n > 100) return 18;
  if (n > 60) return 21;
  return 25;
}

const MAX_TEXT = 200;

/** Управляющие C0/C1 и разделители строк и абзацев (U+2028, U+2029): заменяются пробелом. */
function isControl(c: number): boolean {
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
}

/** Нулевой ширины, метки направления письма и переопределения bidi (U+202A–202E, U+2066–2069), BOM: удаляются. */
function isInvisible(c: number): boolean {
  return (
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x2064) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0xfeff
  );
}

/**
 * Строка для PDF: убирает управляющие символы C0/C1 (переводы строк и табы становятся пробелом),
 * символы направления письма и невидимые символы нулевой ширины, схлопывает пробелы и обрезает
 * до 200 символов. Защита от подделки вида ФИО.
 */
export function sanitizePdfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (isInvisible(c)) continue;
    out += isControl(c) ? ' ' : ch;
  }
  const cleaned = out.replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT).join('').trimEnd() : cleaned;
}
