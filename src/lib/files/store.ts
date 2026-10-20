// Загрузка файла целиком, без Next: проверки → потоковая запись во временный файл → сигнатура →
// очистка метаданных → объект в хранилище → строка files под блокировкой квоты (D-034, up §3.4).
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AdminError } from '../admin/errors';
import { assertAdmin } from '../admin/guard';
import { writeAudit } from '../audit';
import { getDb, newId, now, type Sql } from '../db';
import { UPLOAD_QUOTA_LOCK_KEY } from '../db/locks';
import { isFeatureActive } from '../features';
import { maxBytesFor, minFreeBytes, quotaConfig, storageConfig } from '../storage/config';
import { getStorage, newStorageKey, StorageUnavailableError } from '../storage';
import { FILE_TYPES, PURPOSE_TYPES, UPLOAD_LIMITS } from '../storage/limits';
import { sanitizeFileName } from '../storage/names';
import { sniffFile } from '../storage/sniff';
import { stripImageMetadata } from '../storage/stripMeta';
import { acquireUploadSlot, allowUpload } from './limits';
import { UploadError, type StoredFile, type UploadPurpose } from './types';
import { fileUrl, isUuid } from './url';

export type UploadInput = {
  actor: { id: string; role: string };
  purpose: UploadPurpose;
  courseId: string;
  /** Обязателен для lesson_material. */
  lessonId?: string | null;
  /** Имя из X-Upload-Name (уже декодированное). В журнал не пишется. */
  name: string;
  /** Content-Length. */
  declaredSize: number;
  body: AsyncIterable<Uint8Array>;
};

/** Максимальный размер для цели загрузки: обложка — изображение, материал — максимум из двух видов. */
export function maxDeclaredBytes(purpose: UploadPurpose): number {
  return purpose === 'course_cover' ? maxBytesFor('image') : Math.max(maxBytesFor('image'), maxBytesFor('document'));
}

async function unlinkQuiet(p: string): Promise<void> {
  try {
    await unlink(p);
  } catch {
    // файла уже нет
  }
}

async function usage(courseId: string): Promise<{ total: number; course: number }> {
  const db = await getDb();
  return usageIn(db.sql, courseId);
}

async function usageIn(sql: Sql, courseId: string): Promise<{ total: number; course: number }> {
  const [row] = await sql<{ total: number; course: number }>`
    SELECT COALESCE(SUM(size_bytes), 0)::float8 AS total,
           COALESCE(SUM(size_bytes) FILTER (WHERE course_id = ${courseId}), 0)::float8 AS course
    FROM files WHERE status = 'active'`;
  return { total: Number(row?.total ?? 0), course: Number(row?.course ?? 0) };
}

export async function storeUpload(input: UploadInput): Promise<StoredFile> {
  // 1. флаг
  if (!isFeatureActive('UPLOADS')) throw new UploadError('disabled', 404);

  // 2. только администратор; роль сверяется с БД
  try {
    await assertAdmin(input.actor);
  } catch (e) {
    if (e instanceof AdminError) throw new UploadError('forbidden', 403);
    throw e;
  }

  // 3. параметры
  const { purpose, courseId } = input;
  if (purpose !== 'lesson_material' && purpose !== 'course_cover') throw new UploadError('bad_request', 400);
  if (!isUuid(courseId)) throw new UploadError('not_found', 404);
  const db = await getDb();
  const [course] = await db.sql`SELECT 1 FROM courses WHERE id = ${courseId}`;
  if (!course) throw new UploadError('not_found', 404);
  let lessonId: string | null = null;
  if (purpose === 'lesson_material') {
    if (!input.lessonId || !isUuid(input.lessonId)) throw new UploadError('not_found', 404);
    const [lesson] = await db.sql`SELECT 1 FROM lessons WHERE id = ${input.lessonId} AND course_id = ${courseId}`;
    if (!lesson) throw new UploadError('not_found', 404);
    lessonId = input.lessonId;
  }

  // 4. длина тела
  const declared = input.declaredSize;
  if (!Number.isSafeInteger(declared) || declared < 0) throw new UploadError('length_required', 411);
  if (declared === 0) throw new UploadError('empty', 400);
  const maxDeclared = maxDeclaredBytes(purpose);
  if (declared > maxDeclared) throw new UploadError('too_large', 413, { max: maxDeclared });

  // 5. частота и одновременные загрузки
  if (!allowUpload(input.actor.id)) throw new UploadError('rate_limited', 429);
  const release = acquireUploadSlot(input.actor.id);
  if (!release) throw new UploadError('busy', 429);

  let tmp: string | null = null;
  let key: string | null = null;
  try {
    // 6. хранилище готово и место есть
    // В лог — только код причины и мегабайты: без этого 503 на площадке не разобрать
    const config = storageConfig();
    if (!config.ok) {
      console.warn(`upload: storage unavailable, reason=config:${config.reason}`);
      throw new UploadError('storage_unavailable', 503);
    }
    const storage = getStorage();
    const health = await storage.health();
    if (!health.ok) {
      console.warn('upload: storage unavailable, reason=health');
      throw new UploadError('storage_unavailable', 503);
    }
    const need = minFreeBytes() + declared;
    if (health.freeBytes !== null && health.freeBytes < need) {
      const mib = (n: number) => Math.floor(n / 1024 / 1024);
      console.warn(`upload: storage unavailable, reason=free_space free_mib=${mib(health.freeBytes)} need_mib=${mib(need)}`);
      throw new UploadError('storage_unavailable', 503);
    }

    // 7. предварительная проверка квоты, без блокировки
    const quotas = quotaConfig();
    const before = await usage(courseId);
    if (before.total + declared > quotas.total || before.course + declared > quotas.course) throw new UploadError('quota', 507);

    // 8. потоковая запись с подсчётом байт и sha256
    tmp = path.join(await storage.tempDir(), randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    const fh = await open(tmp, 'wx', 0o600);
    try {
      try {
        for await (const chunk of input.body) {
          size += chunk.length;
          if (size > declared || size > maxDeclared) throw new UploadError('too_large', 413, { max: maxDeclared });
          hash.update(chunk);
          await fh.write(chunk);
        }
      } catch (e) {
        if (e instanceof UploadError) throw e;
        throw new UploadError('bad_request', 400); // обрыв соединения клиентом
      }
    } finally {
      await fh.close();
    }
    if (size === 0) throw new UploadError('empty', 400);
    if (size !== declared) throw new UploadError('bad_request', 400);

    // 9. тип по сигнатуре
    const sniffed = await sniffFile(tmp, size);
    if (!sniffed.ok) throw new UploadError(sniffed.reason === 'macro' ? 'macro' : 'bad_type', 415);
    const ext = sniffed.ext;
    if (!PURPOSE_TYPES[purpose].includes(ext)) throw new UploadError('bad_type', 415);
    const { mime, kind } = FILE_TYPES[ext];
    const limit = maxBytesFor(kind);
    if (size > limit) throw new UploadError('too_large', 413, { max: limit });

    // 10. изображение: размеры, затем чистая копия без EXIF/XMP
    let sha256 = hash.digest('hex');
    let width: number | null = null;
    let height: number | null = null;
    if (kind === 'image' && (ext === 'png' || ext === 'jpg' || ext === 'webp')) {
      width = sniffed.width ?? 0;
      height = sniffed.height ?? 0;
      if (
        width > UPLOAD_LIMITS.imageMaxSide ||
        height > UPLOAD_LIMITS.imageMaxSide ||
        width * height > UPLOAD_LIMITS.imageMaxPixels
      ) {
        throw new UploadError('image_too_large', 413, { max: UPLOAD_LIMITS.imageMaxSide });
      }
      if (purpose === 'course_cover' && (width < UPLOAD_LIMITS.coverMinWidth || height < UPLOAD_LIMITS.coverMinHeight)) {
        throw new UploadError('image_too_small', 422);
      }
      let clean: Uint8Array;
      try {
        clean = stripImageMetadata(ext, await readFile(tmp));
      } catch {
        throw new UploadError('bad_type', 415); // структура не соответствует формату
      }
      await writeFile(tmp, clean);
      size = clean.length;
      sha256 = createHash('sha256').update(clean).digest('hex');
    }

    // 11. объект в хранилище
    key = newStorageKey();
    await storage.putFromTemp(key, tmp);
    tmp = null;

    // 12. строка files под блокировкой: точная проверка квот и вставка по очереди
    const id = newId();
    const storedName = sanitizeFileName(input.name, ext);
    await db.tx(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(${UPLOAD_QUOTA_LOCK_KEY})`;
      const exact = await usageIn(sql, courseId);
      if (exact.total + size > quotas.total || exact.course + size > quotas.course) throw new UploadError('quota', 507);
      await sql`
        INSERT INTO files (id, storage, storage_key, purpose, kind, mime, ext, size_bytes, sha256, original_name,
                           width, height, course_id, lesson_id, uploaded_by, status, created_at)
        VALUES (${id}, ${storage.name}, ${key}, ${purpose}, ${kind}, ${mime}, ${ext}, ${size}, ${sha256}, ${storedName},
                ${width}, ${height}, ${courseId}, ${lessonId}, ${input.actor.id}, 'active', ${now()})`;
      // Имя файла в журнал не пишется: оно может содержать ПДн, а журнал не чистится.
      await writeAudit(sql, {
        actorId: input.actor.id,
        action: 'file.upload',
        entity: 'file',
        entityId: id,
        meta: { courseId, lessonId, purpose, ext, sizeBytes: size },
      });
    });

    return { id, url: fileUrl(id), name: storedName, kind, ext, mime, sizeBytes: size, width, height };
  } catch (e) {
    // транзакция не прошла после переноса объекта — убираем объект
    if (key) {
      try {
        await getStorage().remove(key);
      } catch {
        // подметание бесхозных объектов уберёт
      }
    }
    if (e instanceof StorageUnavailableError) throw new UploadError('storage_unavailable', 503);
    throw e;
  } finally {
    if (tmp) await unlinkQuiet(tmp);
    release();
  }
}
