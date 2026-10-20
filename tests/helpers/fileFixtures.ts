// Синтетические файлы для тестов загрузки: PNG, JPEG, WebP, PDF и мини-ZIP (DOCX/XLSX). Реальных данных нет.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { addLesson, addModule, createCourse } from '../../src/lib/admin';
import type { TestDb } from '../../src/lib/db/testing';
import { storeUpload } from '../../src/lib/files/store';
import type { StoredFile, UploadPurpose } from '../../src/lib/files/types';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32be = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u16be = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u16le = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

// ---------- PNG ----------

export function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32be(data.length), body, u32be(crc32(body))]);
}

/** PNG в оттенках серого. text — чанк tEXt (метаданные для проверки очистки). */
export function png(width = 8, height = 8, opts: { text?: string } = {}): Buffer {
  const ihdr = Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 0, 0, 0, 0])]);
  const raw = Buffer.alloc((width + 1) * height); // фильтр 0 и нулевые пиксели
  const chunks = [pngChunk('IHDR', ihdr)];
  if (opts.text) chunks.push(pngChunk('tEXt', Buffer.from(`Author\0${opts.text}`, 'latin1')));
  chunks.push(pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

// ---------- JPEG ----------

const EXIF_MARK = 'GPS-55.75-37.61';

/** JPEG (baseline или progressive). exif добавляет APP1 с «координатами» и APP13 (IPTC). */
export function jpeg(width = 8, height = 8, opts: { exif?: boolean; progressive?: boolean } = {}): Buffer {
  const seg = (marker: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), u16be(data.length + 2), data]);
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  parts.push(seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')));
  if (opts.exif) {
    parts.push(seg(0xe1, Buffer.from(`Exif\0\0${EXIF_MARK}`, 'latin1')));
    parts.push(seg(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>author</x:xmpmeta>`, 'latin1')));
    parts.push(seg(0xed, Buffer.from('Photoshop 3.0\0iptc-author', 'latin1')));
  }
  parts.push(seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])));
  parts.push(seg(opts.progressive ? 0xc2 : 0xc0, Buffer.concat([Buffer.from([8]), u16be(height), u16be(width), Buffer.from([1, 1, 0x11, 0])])));
  parts.push(seg(0xc4, Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.from([0])])));
  parts.push(seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])));
  parts.push(Buffer.from([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9])); // «пиксельные» данные и EOI
  return Buffer.concat(parts);
}

export const JPEG_EXIF_MARK = EXIF_MARK;

// ---------- WebP ----------

function riffChunk(type: string, data: Buffer): Buffer {
  const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(type, 'ascii'), u32le(data.length), data, pad]);
}

/** WebP: lossy (VP8), lossless (VP8L) или расширенный (VP8X, с EXIF и XMP по желанию). */
export function webp(width = 8, height = 8, kind: 'VP8 ' | 'VP8L' | 'VP8X' = 'VP8 ', opts: { exif?: boolean } = {}): Buffer {
  const pixels = Buffer.alloc(10, 7);
  let chunks: Buffer[];
  if (kind === 'VP8 ') {
    const d = Buffer.alloc(10);
    d.writeUIntLE(0, 0, 3); // frame tag
    d.set([0x9d, 0x01, 0x2a], 3);
    d.writeUInt16LE(width, 6);
    d.writeUInt16LE(height, 8);
    chunks = [riffChunk('VP8 ', d)];
  } else if (kind === 'VP8L') {
    const bits = (width - 1) | ((height - 1) << 14);
    const d = Buffer.alloc(5);
    d[0] = 0x2f;
    d.writeUInt32LE(bits >>> 0, 1);
    chunks = [riffChunk('VP8L', d)];
  } else {
    const d = Buffer.alloc(10);
    d[0] = opts.exif ? 0x08 | 0x04 : 0;
    d.writeUIntLE(width - 1, 4, 3);
    d.writeUIntLE(height - 1, 7, 3);
    chunks = [riffChunk('VP8X', d), riffChunk('VP8 ', pixels)];
    if (opts.exif) chunks.push(riffChunk('EXIF', Buffer.from(`Exif\0\0${EXIF_MARK}`, 'latin1')), riffChunk('XMP ', Buffer.from('<xmp/>')));
  }
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), u32le(body.length), body]);
}

// ---------- PDF и ZIP ----------

export function pdf(extra = ''): Buffer {
  return Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

export type ZipItem = { name: string; data: string | Buffer; deflate?: boolean };

/** Мини-ZIP: stored или deflate; центральный каталог и EOCD без ZIP64. */
export function zip(items: ZipItem[], opts: { comment?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const it of items) {
    const raw = Buffer.isBuffer(it.data) ? it.data : Buffer.from(it.data, 'utf8');
    const packed = it.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(it.name, 'utf8');
    const crc = crc32(raw);
    const method = it.deflate ? 8 : 0;
    const local = Buffer.concat([
      u32le(0x04034b50), u16le(20), u16le(0), u16le(method), u16le(0), u16le(0x21),
      u32le(crc), u32le(packed.length), u32le(raw.length), u16le(name.length), u16le(0), name, packed,
    ]);
    central.push(
      Buffer.concat([
        u32le(0x02014b50), u16le(20), u16le(20), u16le(0), u16le(method), u16le(0), u16le(0x21),
        u32le(crc), u32le(packed.length), u32le(raw.length), u16le(name.length), u16le(0), u16le(0),
        u16le(0), u16le(0), u32le(0), u32le(offset), name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  const comment = Buffer.from(opts.comment ?? '', 'utf8');
  const eocd = Buffer.concat([
    u32le(0x06054b50), u16le(0), u16le(0), u16le(items.length), u16le(items.length),
    u32le(cd.length), u32le(offset), u16le(comment.length), comment,
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}

const CT_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const CT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

function contentTypes(main: string, partName: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    `<Override PartName="${partName}" ContentType="${main}"/></Types>`
  );
}

export function docx(opts: { macro?: boolean } = {}): Buffer {
  const ct = opts.macro ? contentTypes('application/vnd.ms-word.document.macroEnabled.main+xml', '/word/document.xml') : contentTypes(CT_DOCX, '/word/document.xml');
  return zip([
    { name: '[Content_Types].xml', data: ct, deflate: true },
    { name: 'word/document.xml', data: '<w:document/>' },
  ]);
}

export function xlsx(): Buffer {
  return zip([
    { name: '[Content_Types].xml', data: contentTypes(CT_XLSX, '/xl/workbook.xml'), deflate: true },
    { name: 'xl/workbook.xml', data: '<workbook/>' },
  ]);
}

export function docxWithVba(): Buffer {
  return zip([
    { name: '[Content_Types].xml', data: contentTypes(CT_DOCX, '/word/document.xml') },
    { name: 'word/document.xml', data: '<w:document/>' },
    { name: 'word/vbaProject.bin', data: 'x' },
  ]);
}

export const ctDocx = CT_DOCX;
export const ctXlsx = CT_XLSX;
export const contentTypesXml = contentTypes;

/** Асинхронный поток из буфера кусками — тело загрузки без Next. */
export async function* chunked(buf: Uint8Array, size = 16 * 1024): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, Math.min(buf.length, i + size));
}

// ---------- окружение и мир для интеграционных тестов ----------

/** DATABASE_URL с заглушкой делает isDemo() ложным: правила «вне демо». Соединения с этим адресом нет. */
export const NON_DEMO = { DATABASE_URL: 'postgres://example.invalid/crp', FEATURE_UPLOADS: '1' } as const;

/** Подменяет переменные окружения; undefined удаляет. Возвращает функцию отката. */
export function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

/** Временный каталог хранилища вне каталога приложения. */
export async function makeStorageDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'crp-files-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export const admin = { id: 'adm', role: 'admin' };
export const learner = { id: 'lrn', role: 'learner' };

/** Пользователи: админ, слушатель, посторонний и «пониженный» админ (в БД — learner). */
export async function seedUsers(db: TestDb): Promise<void> {
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('adm', 'adm@x.kz', 'Админ', 'admin', 1), ('lrn', 'lrn@x.kz', 'Слушатель', 'learner', 1),
    ('oth', 'oth@x.kz', 'Посторонний', 'learner', 1), ('dem', 'dem@x.kz', 'Пониженный', 'learner', 1)`;
}

export type TestCourse = { courseId: string; moduleId: string; lessonIds: string[] };

/** Курс с модулем и уроками через админские функции; публикация и видимость — прямыми запросами. */
export async function makeCourse(
  db: TestDb,
  opts: { lessons?: number; status?: 'draft' | 'published'; visibility?: 'public' | 'internal' | 'private'; sequential?: boolean } = {},
): Promise<TestCourse> {
  const { id: courseId } = await createCourse(admin, { titleRu: 'Курс' });
  const { id: moduleId } = await addModule(admin, courseId, { titleRu: 'Модуль' });
  const lessonIds: string[] = [];
  for (let i = 0; i < (opts.lessons ?? 1); i++) lessonIds.push((await addLesson(admin, moduleId, { titleRu: `Урок ${i + 1}` })).id);
  await db.sql`
    UPDATE courses SET status = ${opts.status ?? 'draft'}, visibility = ${opts.visibility ?? 'public'},
           sequential = ${opts.sequential ?? false}
    WHERE id = ${courseId}`;
  return { courseId, moduleId, lessonIds };
}

export async function publishLessons(db: TestDb, lessonIds: string[]): Promise<void> {
  const content = db.json({ ru: { v: 1, blocks: [{ id: 't', type: 'text', markdown: 'x' }] } });
  await db.sql`UPDATE lessons SET status = 'published', content = ${content} WHERE id = ANY(${lessonIds})`;
}

/** storeUpload от имени админа с телом из буфера. */
export function upload(
  bytes: Uint8Array,
  opts: { purpose: UploadPurpose; courseId: string; lessonId?: string; name?: string; actor?: { id: string; role: string }; declaredSize?: number },
): Promise<StoredFile> {
  return storeUpload({
    actor: opts.actor ?? admin,
    purpose: opts.purpose,
    courseId: opts.courseId,
    lessonId: opts.lessonId ?? null,
    name: opts.name ?? 'file',
    declaredSize: opts.declaredSize ?? bytes.length,
    body: chunked(bytes),
  });
}
