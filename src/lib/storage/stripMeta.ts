// Удаление метаданных из изображений без перекодирования: пиксели не трогаются.
// EXIF и XMP могут нести ПДн (GPS, автор, модель камеры), поэтому в хранилище попадает чистая копия.
// Побочный эффект: пропадает ориентация EXIF — повёрнутый на телефоне снимок загрузите уже повёрнутым.

/** Структура файла не соответствует формату: вызывающий отвечает «не тот тип». */
export class StripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripError';
  }
}

const u16be = (b: Uint8Array, i: number): number => ((b[i] as number) << 8) | (b[i + 1] as number);
const u32be = (b: Uint8Array, i: number): number => ((b[i] as number) * 2 ** 24) + (((b[i + 1] as number) << 16) | ((b[i + 2] as number) << 8) | (b[i + 3] as number));
const u32le = (b: Uint8Array, i: number): number =>
  (b[i] as number) + (b[i + 1] as number) * 2 ** 8 + (b[i + 2] as number) * 2 ** 16 + (b[i + 3] as number) * 2 ** 24;
const tag = (b: Uint8Array, i: number): string => String.fromCharCode(b[i] as number, b[i + 1] as number, b[i + 2] as number, b[i + 3] as number);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Сегменты метаданных: APP1 (EXIF, XMP), APP11 (JUMBF, C2PA), APP13 (IPTC), COM.
const JPEG_DROP = new Set([0xe1, 0xeb, 0xed, 0xfe]);

/**
 * JPEG: убираем APP1, APP11, APP13 и COM во всём файле, включая промежутки между сканами
 * прогрессивного JPEG. Сжатые данные копируются как есть; на EOI файл заканчивается: хвост
 * (Motion Photo с MP4, вторые кадры MPF со своим EXIF) отбрасывается. Нет EOI — StripError.
 */
function stripJpeg(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new StripError('нет SOI');
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let pos = 2;
  while (pos < b.length) {
    if (b[pos] !== 0xff) throw new StripError('битый маркер');
    const marker = b[pos + 1] as number;
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(b.subarray(pos, pos + 2));
      return concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(b.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > b.length) throw new StripError('обрезанный сегмент');
    const len = u16be(b, pos + 2);
    const end = pos + 2 + len;
    if (len < 2 || end > b.length) throw new StripError('обрезанный сегмент');
    if (!JPEG_DROP.has(marker)) parts.push(b.subarray(pos, end));
    pos = end;
    if (marker === 0xda) pos = skipScan(b, pos, parts);
  }
  throw new StripError('нет EOI');
}

/** Сжатые данные скана до ближайшего маркера (FF00 и RST0–7 — часть данных); возвращает позицию маркера. */
function skipScan(b: Uint8Array, from: number, parts: Uint8Array[]): number {
  let pos = from;
  while (pos + 1 < b.length) {
    if (b[pos] === 0xff) {
      const next = b[pos + 1] as number;
      if (next === 0xff) {
        pos++;
        continue;
      }
      if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) {
        parts.push(b.subarray(from, pos));
        return pos;
      }
      pos += 2;
    } else {
      pos++;
    }
  }
  throw new StripError('нет EOI');
}

const PNG_DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

/** PNG: убираем текстовые чанки и eXIf, остальные копируем вместе с CRC. */
function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let pos = 8;
  let first = true;
  let sawEnd = false;
  while (pos + 12 <= b.length) {
    const len = u32be(b, pos);
    const end = pos + 12 + len;
    if (end > b.length) throw new StripError('обрезанный чанк');
    const type = tag(b, pos + 4);
    if (first && type !== 'IHDR') throw new StripError('нет IHDR');
    first = false;
    if (!PNG_DROP.has(type)) parts.push(b.subarray(pos, end));
    pos = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new StripError('нет IEND');
  return concat(parts);
}

const WEBP_DROP = new Set(['EXIF', 'XMP ']);

/** WebP: убираем чанки EXIF и «XMP », сбрасываем их флаги в VP8X, пересчитываем размер RIFF. */
function stripWebp(b: Uint8Array): Uint8Array {
  if (b.length < 12 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WEBP') throw new StripError('нет RIFF');
  const riffEnd = Math.min(b.length, 8 + u32le(b, 4));
  const parts: Uint8Array[] = [b.slice(0, 12)];
  let pos = 12;
  while (pos + 8 <= riffEnd) {
    const len = u32le(b, pos + 4);
    const end = pos + 8 + len + (len % 2);
    if (pos + 8 + len > riffEnd) throw new StripError('обрезанный чанк');
    const type = tag(b, pos);
    if (!WEBP_DROP.has(type)) {
      const chunk = b.slice(pos, Math.min(end, riffEnd));
      if (type === 'VP8X' && len >= 1) chunk[8] = (chunk[8] as number) & ~0x0c; // EXIF (0x08) и XMP (0x04)
      parts.push(chunk);
    }
    pos = end;
  }
  const out = concat(parts);
  const size = out.length - 8;
  out[4] = size & 0xff;
  out[5] = (size >> 8) & 0xff;
  out[6] = (size >> 16) & 0xff;
  out[7] = (size >>> 24) & 0xff;
  return out;
}

/** Копия изображения без EXIF/XMP/IPTC и текстовых чанков; пиксели не трогаются. */
export function stripImageMetadata(ext: 'png' | 'jpg' | 'webp', bytes: Uint8Array): Uint8Array {
  if (ext === 'jpg') return stripJpeg(bytes);
  if (ext === 'png') return stripPng(bytes);
  return stripWebp(bytes);
}
