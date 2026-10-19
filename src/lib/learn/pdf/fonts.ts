// Регистрация шрифтов в react-pdf: статические срезы из assets/fonts/pdf (D-036).
import path from 'node:path';
import { Font } from '@react-pdf/renderer';

export const PDF_FONT_DIR = path.join(process.cwd(), 'assets/fonts/pdf');

/**
 * Регистрирует шрифты заново: хранилище Font глобальное, а разобранные шрифты в нём накапливают
 * состояние между документами. Если не сбрасывать, во втором документе процесса символы, которых
 * не было в первом, теряются (пропадают из текста, ломается разбиение на строки). Поэтому
 * вызывать только внутри очереди рендера (render.ts): сброс посреди чужого рендера его сломал бы.
 * src — абсолютный путь: файлы попадают в сборку через outputFileTracingIncludes.
 */
export function registerPdfFonts(): void {
  Font.clear();
  // clear() убирает и стандартное семейство, а react-pdf требует его как запасное
  Font.register({
    family: 'Helvetica',
    fonts: [
      { src: 'Helvetica', fontStyle: 'normal', fontWeight: 400 },
      { src: 'Helvetica-Bold', fontStyle: 'normal', fontWeight: 700 },
      { src: 'Helvetica-Oblique', fontStyle: 'italic', fontWeight: 400 },
      { src: 'Helvetica-BoldOblique', fontStyle: 'italic', fontWeight: 700 },
    ],
  });
  Font.register({
    family: 'Geologica',
    fonts: [{ src: path.join(PDF_FONT_DIR, 'Geologica-Bold-SHRP100.ttf'), fontWeight: 700 }],
  });
  Font.register({
    family: 'Onest',
    fonts: [
      { src: path.join(PDF_FONT_DIR, 'Onest-Regular.ttf'), fontWeight: 400 },
      { src: path.join(PDF_FONT_DIR, 'Onest-SemiBold.ttf'), fontWeight: 600 },
    ],
  });
  // без переносов внутри слов (английские правила ломают кириллицу), но после дефиса строку
  // можно разорвать: двойные фамилии вроде Құрманғалиқызы-Нұрсұлтанова иначе уходят за рамку
  Font.registerHyphenationCallback((word) => word.split(/(?<=-)/));
}
