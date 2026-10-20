// stripImageMetadata: из JPEG, PNG и WebP уходят метаданные, пиксельные данные не меняются.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sniffImageHeader } from '../../src/lib/storage/sniff';
import { StripError, stripImageMetadata } from '../../src/lib/storage/stripMeta';
import { crc32, JPEG_EXIF_MARK, jpeg, png, webp } from '../helpers/fileFixtures';

const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));

test('JPEG: пропадают APP1 (EXIF, XMP) и APP13, SOS и данные побайтно равны', () => {
  const src = jpeg(40, 30, { exif: true });
  const out = stripImageMetadata('jpg', src);
  assert.equal(has(src, JPEG_EXIF_MARK), true);
  assert.equal(has(out, JPEG_EXIF_MARK), false);
  assert.equal(has(out, 'xmpmeta'), false);
  assert.equal(has(out, 'iptc-author'), false);
  const sos = (b: Uint8Array) => Buffer.from(b).subarray(Buffer.from(b).indexOf(Buffer.from([0xff, 0xda])));
  assert.deepEqual(sos(out), sos(src));
  assert.deepEqual(sniffImageHeader(out), { ext: 'jpg', width: 40, height: 30 });
});

test('JPEG без метаданных остаётся тем же набором байт', () => {
  const src = jpeg(10, 10);
  assert.deepEqual(Buffer.from(stripImageMetadata('jpg', src)), src);
});

test('JPEG: хвост после EOI (вложенный кадр с EXIF, MP4 с GPS) отбрасывается, байты до EOI не меняются', () => {
  const src = jpeg(12, 9);
  const tail = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0e]),
    Buffer.from('Exif\0\0GPS-LAT-1', 'latin1'),
    Buffer.from('ftypmp4 GPS+043.2389', 'latin1'),
  ]);
  const out = Buffer.from(stripImageMetadata('jpg', Buffer.concat([src, tail])));
  assert.equal(has(out, 'GPS'), false);
  assert.equal(has(out, 'ftyp'), false);
  assert.deepEqual(out, src);
});

test('JPEG: данные скана с FF00 и RST не режутся; APP11 и COM между сканами удаляются; без EOI — StripError', () => {
  const seg = (marker: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff]), data]);
  const sos = seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
  const scan1 = Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]);
  const base = jpeg(8, 8);
  const head = base.subarray(0, base.indexOf(Buffer.from([0xff, 0xda])));
  const src = Buffer.concat([head, sos, scan1, seg(0xeb, Buffer.from('jumb-author')), seg(0xfe, Buffer.from('comment')), sos, Buffer.from([0x44, 0xff, 0xd9])]);
  const out = Buffer.from(stripImageMetadata('jpg', src));
  assert.equal(has(out, 'jumb-author'), false);
  assert.equal(has(out, 'comment'), false);
  assert.equal(out.includes(scan1), true);
  assert.equal(out.length, src.length - (4 + 'jumb-author'.length) - (4 + 'comment'.length)) // удалены два сегмента с заголовками;
  assert.throws(() => stripImageMetadata('jpg', src.subarray(0, src.length - 2)), StripError);
});

test('PNG: пропадает tEXt, IHDR и IDAT не изменены, CRC корректны', () => {
  const src = png(16, 12, { text: 'Ivan Ivanov' });
  const out = Buffer.from(stripImageMetadata('png', src));
  assert.equal(has(src, 'Ivan Ivanov'), true);
  assert.equal(has(out, 'Ivan Ivanov'), false);
  assert.equal(has(out, 'tEXt'), false);
  // обход чанков: типы и CRC
  const types: string[] = [];
  for (let pos = 8; pos < out.length; ) {
    const len = out.readUInt32BE(pos);
    const body = out.subarray(pos + 4, pos + 8 + len);
    assert.equal(out.readUInt32BE(pos + 8 + len), crc32(body));
    types.push(out.toString('latin1', pos + 4, pos + 8));
    pos += 12 + len;
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual(sniffImageHeader(out), { ext: 'png', width: 16, height: 12 });
});

test('PNG: eXIf, iTXt и zTXt тоже удаляются', () => {
  const base = png(4, 4);
  const chunk = (type: string, data: string) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data, 'latin1')]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const iend = base.length - 12;
  const src = Buffer.concat([base.subarray(0, iend), chunk('eXIf', 'SECRET1'), chunk('iTXt', 'SECRET2'), chunk('zTXt', 'SECRET3'), base.subarray(iend)]);
  const out = stripImageMetadata('png', src);
  for (const s of ['SECRET1', 'SECRET2', 'SECRET3']) assert.equal(has(out, s), false, s);
});

test('WebP: пропадают EXIF и «XMP », флаги VP8X сброшены, размер RIFF пересчитан', () => {
  const src = webp(64, 48, 'VP8X', { exif: true });
  const out = Buffer.from(stripImageMetadata('webp', src));
  assert.equal(has(src, JPEG_EXIF_MARK), true);
  assert.equal(has(out, JPEG_EXIF_MARK), false);
  assert.equal(has(out, 'XMP '), false);
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.equal((out[20] ?? 0) & 0x0c, 0, 'флаги EXIF/XMP сброшены');
  assert.deepEqual(sniffImageHeader(out), { ext: 'webp', width: 64, height: 48 });
});

test('битая структура — StripError', () => {
  assert.throws(() => stripImageMetadata('jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0])), StripError);
  assert.throws(() => stripImageMetadata('png', png().subarray(0, 40)), StripError);
  assert.throws(() => stripImageMetadata('webp', Buffer.from('RIFF')), StripError);
});
