// Минимальные типы fontkit (транзитивная зависимость react-pdf, своих типов в дереве нет).
declare module 'fontkit' {
  export interface Font {
    unitsPerEm: number;
    layout(text: string): { advanceWidth: number };
    glyphForCodePoint(codePoint: number): { advanceWidth: number };
  }
  export function openSync(path: string): Font;
}
