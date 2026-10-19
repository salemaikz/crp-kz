// Ширина текста в Geologica Bold: мерит сам шрифт через fontkit (его же использует react-pdf).
import path from 'node:path';
import * as fontkit from 'fontkit';
import type { Measure } from './layout';
import { PDF_FONT_DIR } from './paths';

let font: fontkit.Font | null = null;

/**
 * Мера ширины для fitText. letterSpacingEm — трекинг в долях кегля (у ФИО -0,03); он прибавляется
 * к каждому знаку, как делает react-pdf.
 */
export function geologicaMeasure(letterSpacingEm = 0): Measure {
  font ??= fontkit.openSync(path.join(PDF_FONT_DIR, 'Geologica-Bold-SHRP100.ttf'));
  const f = font;
  return (text, size) =>
    (f.layout(text).advanceWidth / f.unitsPerEm) * size + letterSpacingEm * size * Array.from(text).length;
}
