// Какие символы есть в шрифте ФИО и названия курса (Geologica Bold): остальные из текста убираются.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readCmapCodePoints } from './cmap';
import { PDF_FONT_DIR } from './fonts';

let cmap: Set<number> | null = null;

/** Есть ли в Geologica глиф для символа. Cmap читается один раз на процесс. */
export function hasPdfGlyph(codePoint: number): boolean {
  cmap ??= readCmapCodePoints(readFileSync(path.join(PDF_FONT_DIR, 'Geologica-Bold-SHRP100.ttf')));
  return cmap.has(codePoint);
}
