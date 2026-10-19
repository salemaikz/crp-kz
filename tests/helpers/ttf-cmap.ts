// Разбор cmap живёт в src/lib/learn/pdf/cmap.ts (нужен и рендеру); тесты берут его отсюда.
export { readCmapCodePoints } from '../../src/lib/learn/pdf/cmap';

/** Кодовые точки всех символов строки. */
export function codePointsOf(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0)!);
}
