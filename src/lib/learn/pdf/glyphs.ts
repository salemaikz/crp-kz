// Какие символы есть в шрифте ФИО и названия курса (Geologica Bold): остальные из текста убираются.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readCmapCodePoints } from './cmap';
import { sanitizePdfTextDetailed } from './layout';
import { PDF_FONT_DIR } from './paths';

let cmap: Set<number> | null = null;

/**
 * ФИО и название курса после очистки; пустая строка значит, что в шрифте не нашлось ни одного знака.
 * droppedLetters: у имени или курса выброшены буквы без глифа (текст вышел бы обрезанным).
 */
export function cleanCertificateTexts(c: { holderName: string; courseTitle: string }): {
  holder: string;
  course: string;
  droppedLetters: boolean;
} {
  const holder = sanitizePdfTextDetailed(c.holderName, hasPdfGlyph);
  const course = sanitizePdfTextDetailed(c.courseTitle, hasPdfGlyph);
  return { holder: holder.text, course: course.text, droppedLetters: holder.droppedLetters || course.droppedLetters };
}

/** Есть ли в Geologica глиф для символа. Cmap читается один раз на процесс. */
export function hasPdfGlyph(codePoint: number): boolean {
  cmap ??= readCmapCodePoints(readFileSync(path.join(PDF_FONT_DIR, 'Geologica-Bold-SHRP100.ttf')));
  return cmap.has(codePoint);
}
