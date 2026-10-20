// Тип файла по сигнатуре (не по расширению и не по Content-Type клиента). Файл целиком не читается:
// голова до 64 КБ, для ZIP — хвост и центральный каталог.
import { open } from 'node:fs/promises';
import { UPLOAD_LIMITS, type FileExt } from './limits';
import { classifyOoxml } from './ooxml';
import { readZipDirectory, readZipText, ZipError } from './zip';

export type Sniffed =
  | { ok: true; ext: FileExt; width?: number; height?: number }
  | { ok: false; reason: 'bad_type' | 'macro' | 'corrupt' };

const HEAD_BYTES = 64 * 1024;
/** Заголовки с большими EXIF/ICC сдвигают SOF дальше первых 64 КБ. */
const JPEG_HEAD_BYTES = 1024 * 1024;

type ImageInfo = { ext: 'png' | 'jpg' | 'webp'; width: number; height: number };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  return b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
}

const ascii = (b: Uint8Array, at: number, len: number): string => String.fromCharCode(...b.subarray(at, at + len));
const u16be = (b: Uint8Array, i: number): number => ((b[i] as number) << 8) | (b[i + 1] as number);
const u32be = (b: Uint8Array, i: number): number => u16be(b, i) * 65536 + u16be(b, i + 2);
const u16le = (b: Uint8Array, i: number): number => (b[i] as number) | ((b[i + 1] as number) << 8);

function pngInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  return width > 0 && height > 0 ? { ext: 'png', width, height } : null;
}

/** Размеры JPEG: проход по маркерам до SOF0..SOF15 (кроме C4, C8, CC). */
function jpegInfo(b: Uint8Array): ImageInfo | null {
  let pos = 2;
  for (let guard = 0; guard < 4096 && pos + 4 <= b.length; guard++) {
    if (b[pos] !== 0xff) return null;
    const marker = b[pos + 1] as number;
    if (marker === 0xff) {
      pos++; // заполнитель
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2; // маркеры без длины
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // конец до SOF
    const len = u16be(b, pos + 2);
    if (len < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (pos + 9 > b.length) return null;
      const height = u16be(b, pos + 5);
      const width = u16be(b, pos + 7);
      return width > 0 && height > 0 ? { ext: 'jpg', width, height } : null;
    }
    pos += 2 + len;
  }
  return null;
}

function webpInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 21 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const kind = ascii(b, 12, 4);
  const d = 20; // начало данных первого чанка
  let width = 0;
  let height = 0;
  if (kind === 'VP8 ') {
    if (b.length < d + 10 || b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
    width = u16le(b, d + 6) & 0x3fff;
    height = u16le(b, d + 8) & 0x3fff;
  } else if (kind === 'VP8L') {
    if (b.length < d + 5 || b[d] !== 0x2f) return null;
    const b1 = b[d + 1] as number;
    const b2 = b[d + 2] as number;
    const b3 = b[d + 3] as number;
    const b4 = b[d + 4] as number;
    width = 1 + (((b2 & 0x3f) << 8) | b1);
    height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
  } else if (kind === 'VP8X') {
    if (b.length < d + 10) return null;
    width = 1 + ((b[d + 4] as number) | ((b[d + 5] as number) << 8) | ((b[d + 6] as number) << 16));
    height = 1 + ((b[d + 7] as number) | ((b[d + 8] as number) << 8) | ((b[d + 9] as number) << 16));
  } else {
    return null;
  }
  return width > 0 && height > 0 ? { ext: 'webp', width, height } : null;
}

/** Изображение по голове файла (PNG, JPEG, WebP) или null. */
export function sniffImageHeader(head: Uint8Array): ImageInfo | null {
  if (startsWith(head, PNG_SIG)) return pngInfo(head);
  if (startsWith(head, [0xff, 0xd8, 0xff])) return jpegInfo(head);
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && ascii(head, 8, 4) === 'WEBP') return webpInfo(head);
  return null;
}

function isPdf(head: Uint8Array): boolean {
  return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]) || startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d, 0x32, 0x2e]);
}

export async function sniffFile(path: string, size: number): Promise<Sniffed> {
  if (size < 4) return { ok: false, reason: 'bad_type' };
  const fh = await open(path, 'r');
  try {
    const read = async (len: number): Promise<Buffer> => {
      const buf = Buffer.alloc(Math.min(len, size));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return buf.subarray(0, bytesRead);
    };
    let head = await read(HEAD_BYTES);

    if (startsWith(head, [0xff, 0xd8, 0xff]) && size > HEAD_BYTES) head = await read(JPEG_HEAD_BYTES);
    const kindSig =
      startsWith(head, PNG_SIG) || startsWith(head, [0xff, 0xd8, 0xff]) || (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP');
    if (kindSig) {
      const info = sniffImageHeader(head);
      return info ? { ok: true, ext: info.ext, width: info.width, height: info.height } : { ok: false, reason: 'corrupt' };
    }
    if (isPdf(head)) return { ok: true, ext: 'pdf' };

    if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
      try {
        const dir = await readZipDirectory(fh, size);
        const ct = dir.find((e) => e.name === '[Content_Types].xml');
        if (!ct) return { ok: false, reason: 'bad_type' };
        const xml = await readZipText(fh, size, ct, UPLOAD_LIMITS.contentTypesMaxBytes);
        const kind = classifyOoxml(dir, xml);
        if (kind === 'macro') return { ok: false, reason: 'macro' };
        return kind ? { ok: true, ext: kind } : { ok: false, reason: 'bad_type' };
      } catch (e) {
        if (e instanceof ZipError) return { ok: false, reason: 'corrupt' };
        throw e;
      }
    }
    return { ok: false, reason: 'bad_type' };
  } finally {
    await fh.close();
  }
}
