// Минимальное чтение ZIP для проверки DOCX/XLSX: только центральный каталог и [Content_Types].xml.
// Архив не распаковывается: ZIP-бомба невозможна (размеры и число записей ограничены, вывод inflate — тоже).
import type { FileHandle } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { UPLOAD_LIMITS } from './limits';

export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

/** Архив повреждён или нарушает наши ограничения (ZIP64, слишком много записей, опасные имена). */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 65_535;

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  if (bytesRead !== len) throw new ZipError('короткое чтение');
  return buf;
}

function safeName(name: string): boolean {
  if (name.startsWith('/') || name.includes('\0')) return false;
  return !name.split(/[\\/]/).includes('..');
}

/** Центральный каталог: записи или ZipError. Размер файла передаёт вызывающий (fstat уже сделан). */
export async function readZipDirectory(fh: FileHandle, size: number): Promise<ZipEntry[]> {
  const tailLen = Math.min(size, EOCD_MIN + MAX_COMMENT);
  if (tailLen < EOCD_MIN) throw new ZipError('нет конца архива');
  const tail = await readAt(fh, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG && i + EOCD_MIN + tail.readUInt16LE(i + 20) <= tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('нет конца архива');
  if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) throw new ZipError('ZIP64');

  const total = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffff_ffff || cdOffset === 0xffff_ffff) throw new ZipError('ZIP64');
  if (total > UPLOAD_LIMITS.zipMaxEntries) throw new ZipError('слишком много записей');
  if (cdSize > UPLOAD_LIMITS.zipMaxCentralDirBytes) throw new ZipError('каталог слишком велик');
  if (cdOffset + cdSize > size) throw new ZipError('каталог за пределами файла');

  const cd = await readAt(fh, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let pos = 0;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== CD_SIG) throw new ZipError('битая запись каталога');
    const nameLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const commentLen = cd.readUInt16LE(pos + 32);
    const end = pos + 46 + nameLen + extraLen + commentLen;
    if (end > cd.length) throw new ZipError('битая запись каталога');
    const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen);
    if (!safeName(name)) throw new ZipError('опасное имя записи');
    entries.push({
      name,
      method: cd.readUInt16LE(pos + 10),
      compressedSize: cd.readUInt32LE(pos + 20),
      size: cd.readUInt32LE(pos + 24),
      offset: cd.readUInt32LE(pos + 42),
    });
    pos = end;
  }
  return entries;
}

/** Текст записи (stored или deflate) с жёстким пределом на выход. */
export async function readZipText(fh: FileHandle, fileSize: number, entry: ZipEntry, maxBytes: number): Promise<string> {
  if (entry.compressedSize > maxBytes || entry.size > maxBytes) throw new ZipError('запись слишком велика');
  if (entry.offset + 30 > fileSize) throw new ZipError('запись за пределами файла');
  const head = await readAt(fh, entry.offset, 30);
  if (head.readUInt32LE(0) !== LOCAL_SIG) throw new ZipError('битый локальный заголовок');
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (start + entry.compressedSize > fileSize) throw new ZipError('запись за пределами файла');
  const data = await readAt(fh, start, entry.compressedSize);
  if (entry.method === 0) return data.toString('utf8');
  if (entry.method !== 8) throw new ZipError('неподдерживаемое сжатие');
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes }).toString('utf8');
  } catch {
    throw new ZipError('не удалось распаковать запись');
  }
}
