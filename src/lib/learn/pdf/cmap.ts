// Разбор таблицы cmap в TTF (форматы 4 и 12): какие символы Unicode есть в шрифте.
// Нужен рендеру PDF (убрать из текста символы, которых нет в шрифте: иначе react-pdf падает) и
// тесту шрифтов (срез без казахских букв дал бы «тофу» в сертификате).

/** Множество кодовых точек Unicode, для которых в шрифте есть глиф (glyph id ≠ 0). */
export function readCmapCodePoints(font: Uint8Array): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = view.getUint16(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(font[rec]!, font[rec + 1]!, font[rec + 2]!, font[rec + 3]!);
    if (tag === 'cmap') cmapOffset = view.getUint32(rec + 8);
  }
  if (cmapOffset < 0) throw new Error('в шрифте нет таблицы cmap');

  const out = new Set<number>();
  const count = view.getUint16(cmapOffset + 2);
  for (let i = 0; i < count; i++) {
    const sub = cmapOffset + view.getUint32(cmapOffset + 4 + i * 8 + 4);
    const format = view.getUint16(sub);
    if (format === 4) readFormat4(view, sub, out);
    else if (format === 12) readFormat12(view, sub, out);
  }
  return out;
}

function readFormat4(view: DataView, at: number, out: Set<number>): void {
  const segX2 = view.getUint16(at + 6);
  const seg = segX2 / 2;
  const endAt = at + 14;
  const startAt = endAt + segX2 + 2;
  const deltaAt = startAt + segX2;
  const rangeAt = deltaAt + segX2;
  for (let s = 0; s < seg; s++) {
    const end = view.getUint16(endAt + s * 2);
    const start = view.getUint16(startAt + s * 2);
    const delta = view.getInt16(deltaAt + s * 2);
    const rangeOffset = view.getUint16(rangeAt + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        const gAt = rangeAt + s * 2 + rangeOffset + (c - start) * 2;
        const raw = gAt + 2 <= view.byteLength ? view.getUint16(gAt) : 0;
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(c);
    }
  }
}

function readFormat12(view: DataView, at: number, out: Set<number>): void {
  const groups = view.getUint32(at + 12);
  for (let g = 0; g < groups; g++) {
    const rec = at + 16 + g * 12;
    const start = view.getUint32(rec);
    const end = view.getUint32(rec + 4);
    const firstGlyph = view.getUint32(rec + 8);
    for (let c = start; c <= end; c++) if (firstGlyph + (c - start) !== 0) out.add(c);
  }
}
