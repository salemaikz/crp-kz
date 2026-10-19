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

/** Минимальные кегли в pt: нижние ступени nameFontSize и courseFontSize. */
export const NAME_MIN_SIZE = 26;
export const COURSE_MIN_SIZE = 18;

/** Ширина строки в pt при данном кегле (с учётом трекинга); в рантайме мерит сам шрифт (measure.ts). */
export type Measure = (text: string, size: number) => number;

const STEP = 0.5;

/** Ширина самого широкого неразрывного слова: перенос идёт только по пробелам, дефис слово не разрывает. */
function widest(text: string, size: number, measure: Measure): number {
  return text.split(/\s+/).reduce((m, w) => Math.max(m, w ? measure(w, size) : 0), 0);
}

/**
 * Уменьшает кегль (шагом 0,5 pt, не ниже minSize), пока самое длинное неразрывное слово не влезет
 * в maxWidth. Ширину даёт measure, то есть сам шрифт, а не оценка на знак.
 */
export function fitFontSize(size: number, text: string, maxWidth: number, measure: Measure, minSize: number): number {
  let cur = size;
  while (cur > minSize && widest(text, cur, measure) > maxWidth) cur = Math.max(minSize, cur - STEP);
  return cur;
}

/** Режет слово на части, каждая из которых влезает в maxWidth (хотя бы по одному знаку). */
function chunkWord(word: string, size: number, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cur && measure(cur + ch, size) > maxWidth) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Кегль и текст для строки на листе. Сначала уменьшается кегль до minSize; если слово не влезает
 * и на минимуме (патологический ввод вроде 200 букв без пробелов), оно режется пробелами на части,
 * чтобы текст не вылез за рамку.
 */
export function fitText(
  text: string,
  size: number,
  minSize: number,
  maxWidth: number,
  measure: Measure,
): { text: string; size: number } {
  const fitted = Math.min(size, fitFontSize(size, text, maxWidth, measure, minSize));
  if (widest(text, fitted, measure) <= maxWidth) return { text, size: fitted };
  const cut = text
    .split(/\s+/)
    .flatMap((w) => (measure(w, fitted) > maxWidth ? chunkWord(w, fitted, maxWidth, measure) : [w]))
    .join(' ');
  return { text: cut, size: fitted };
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
 * hasGlyph — есть ли символ в шрифте: отсутствующие (эмодзи, иероглифы, галочки) удаляются, иначе
 * react-pdf падает на всём документе. Без hasGlyph проверки по шрифту нет.
 */
export function sanitizePdfText(s: string, hasGlyph?: (codePoint: number) => boolean): string {
  let out = '';
  // NFC до проверки глифов: в NFD «й» и «ё» приходят базовой буквой и combining-знаком; знак
  // выпал бы как «нет в шрифте», и «Й» превратилась бы в «И»
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (isInvisible(c)) continue;
    if (hasGlyph && !isControl(c) && !/\s/.test(ch) && !hasGlyph(c)) continue;
    out += isControl(c) ? ' ' : ch;
  }
  const cleaned = out.replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT).join('').trimEnd() : cleaned;
}
