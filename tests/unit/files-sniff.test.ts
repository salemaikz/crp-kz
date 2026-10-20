// Тип файла по сигнатуре: sniffFile, sniffImageHeader, classifyOoxml.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { sniffFile, sniffImageHeader, type Sniffed } from '../../src/lib/storage/sniff';
import {
  contentTypesXml,
  ctDocx,
  ctXlsx,
  docx,
  docxWithVba,
  jpeg,
  pdf,
  png,
  webp,
  xlsx,
  zip,
} from '../helpers/fileFixtures';

let dir = '';
let n = 0;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'crp-sniff-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function sniff(buf: Uint8Array): Promise<Sniffed> {
  const p = path.join(dir, `f${n++}`);
  await writeFile(p, buf);
  return sniffFile(p, buf.length);
}

test('PNG, JPEG (baseline и progressive), WebP (VP8, VP8L, VP8X): тип и размеры', async () => {
  assert.deepEqual(await sniff(png(120, 45)), { ok: true, ext: 'png', width: 120, height: 45 });
  assert.deepEqual(await sniff(jpeg(640, 480)), { ok: true, ext: 'jpg', width: 640, height: 480 });
  assert.deepEqual(await sniff(jpeg(300, 200, { progressive: true, exif: true })), { ok: true, ext: 'jpg', width: 300, height: 200 });
  assert.deepEqual(await sniff(webp(321, 123, 'VP8 ')), { ok: true, ext: 'webp', width: 321, height: 123 });
  assert.deepEqual(await sniff(webp(1000, 700, 'VP8L')), { ok: true, ext: 'webp', width: 1000, height: 700 });
  assert.deepEqual(await sniff(webp(1280, 720, 'VP8X')), { ok: true, ext: 'webp', width: 1280, height: 720 });
});

test('sniffImageHeader работает по голове файла', () => {
  assert.deepEqual(sniffImageHeader(png(10, 20)), { ext: 'png', width: 10, height: 20 });
  assert.equal(sniffImageHeader(Buffer.from('<html>')), null);
});

test('JPEG с большим EXIF: SOF дальше первых 64 КБ', async () => {
  const big = jpeg(64, 48);
  const soi = big.subarray(0, 2);
  const rest = big.subarray(2);
  const filler = Buffer.concat([Buffer.from([0xff, 0xe2, 0xff, 0xff]), Buffer.alloc(0xffff - 2, 1)]);
  const buf = Buffer.concat([soi, filler, filler, rest]);
  assert.deepEqual(await sniff(buf), { ok: true, ext: 'jpg', width: 64, height: 48 });
});

test('PDF строго с нулевого байта', async () => {
  assert.deepEqual(await sniff(pdf()), { ok: true, ext: 'pdf' });
  assert.deepEqual(await sniff(Buffer.concat([Buffer.from('\n'), pdf()])), { ok: false, reason: 'bad_type' });
  assert.deepEqual(await sniff(Buffer.concat([Buffer.from('GIF89a'), pdf()])), { ok: false, reason: 'bad_type' });
});

test('DOCX и XLSX из мини-ZIP (stored и deflate)', async () => {
  assert.deepEqual(await sniff(docx()), { ok: true, ext: 'docx' });
  assert.deepEqual(await sniff(xlsx()), { ok: true, ext: 'xlsx' });
});

test('bad_type: SVG, HTML под видом PNG, GIF, CFB, пустой и обрезанный файл', async () => {
  const bad = { ok: false, reason: 'bad_type' };
  assert.deepEqual(await sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), bad);
  assert.deepEqual(await sniff(Buffer.from('<html><script>alert(1)</script></html>')), bad);
  assert.deepEqual(await sniff(Buffer.from('GIF89a\x01\x00\x01\x00')), bad);
  assert.deepEqual(await sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])), bad);
  assert.deepEqual(await sniff(Buffer.alloc(0)), bad);
  assert.deepEqual(await sniff(Buffer.from([0x25, 0x50])), bad);
});

test('bad_type: ZIP без word/ и xl/, ZIP с обоими, ZIP без [Content_Types].xml', async () => {
  const bad = { ok: false, reason: 'bad_type' };
  assert.deepEqual(await sniff(zip([{ name: 'a.txt', data: 'x' }])), bad);
  assert.deepEqual(await sniff(zip([{ name: '[Content_Types].xml', data: contentTypesXml(ctDocx, '/word/document.xml') }])), bad);
  const both = zip([
    { name: '[Content_Types].xml', data: contentTypesXml(ctDocx, '/word/document.xml') + contentTypesXml(ctXlsx, '/xl/workbook.xml') },
    { name: 'word/document.xml', data: '<d/>' },
    { name: 'xl/workbook.xml', data: '<w/>' },
  ]);
  assert.deepEqual(await sniff(both), bad);
  assert.deepEqual(await sniff(zip([{ name: 'word/document.xml', data: '<d/>' }])), bad);
});

test('macro: vbaProject.bin, macroEnabled, activeX/', async () => {
  const macro = { ok: false, reason: 'macro' };
  assert.deepEqual(await sniff(docxWithVba()), macro);
  assert.deepEqual(await sniff(docx({ macro: true })), macro);
  const activeX = zip([
    { name: '[Content_Types].xml', data: contentTypesXml(ctDocx, '/word/document.xml') },
    { name: 'word/document.xml', data: '<d/>' },
    { name: 'word/activeX/activeX1.xml', data: '<a/>' },
  ]);
  assert.deepEqual(await sniff(activeX), macro);
});

test('corrupt: ZIP с «../» в имени, ZIP64, слишком много записей, [Content_Types].xml-бомба', async () => {
  const corrupt = { ok: false, reason: 'corrupt' };
  assert.deepEqual(await sniff(zip([{ name: '../evil.xml', data: 'x' }, { name: '[Content_Types].xml', data: '<T/>' }])), corrupt);
  assert.deepEqual(await sniff(zip([{ name: '/abs.xml', data: 'x' }])), corrupt);

  const z64 = Buffer.from(docx());
  z64.writeUInt32LE(0xffffffff, z64.length - 6); // смещение каталога в EOCD
  assert.deepEqual(await sniff(z64), corrupt);

  const many = zip(Array.from({ length: 5001 }, (_, i) => ({ name: `f${i}.txt`, data: '' })));
  assert.deepEqual(await sniff(many), corrupt);

  const bomb = zip([
    { name: '[Content_Types].xml', data: Buffer.alloc(3 * 1024 * 1024, 0x20), deflate: true },
    { name: 'word/document.xml', data: '<d/>' },
  ]);
  assert.deepEqual(await sniff(bomb), corrupt);
});

test('corrupt: JPEG без SOF и WebP с битым заголовком, PNG без IHDR', async () => {
  const corrupt = { ok: false, reason: 'corrupt' };
  const noSof = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]), Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])]);
  assert.deepEqual(await sniff(noSof), corrupt);
  const broken = Buffer.from(webp(10, 10, 'VP8 '));
  broken.write('JUNK', 12, 'ascii');
  assert.deepEqual(await sniff(broken), corrupt);
  const noIhdr = Buffer.from(png());
  noIhdr.write('XXXX', 12, 'ascii');
  assert.deepEqual(await sniff(noIhdr), corrupt);
});
