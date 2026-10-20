// Подметание файлов (крон ежедневно, scripts/files-sweep.ts). Работает независимо от флага UPLOADS:
// оно только удаляет, а удаление защищено проверкой ссылок (К-11).
import { writeAudit } from '../audit';
import { getDb, now } from '../db';
import { getStorage } from '../storage';
import { UPLOAD_LIMITS } from '../storage/limits';
import type { FileRow } from './types';

/**
 * Неиспользуемые файлы старше graceMs (не в lesson_files, не обложка): status='deleted', затем объект.
 * Гонка с сохранением урока: кандидаты → строка FOR UPDATE → НОВЫМ запросом перепроверка ссылок →
 * UPDATE → коммит → удаление объекта. Сохранение урока берёт FOR SHARE на те же строки, поэтому
 * исходов два: урок сохранён и файл жив, либо файл удалён и урок отклонён (file_not_found).
 */
export async function sweepOrphanFiles(
  opts: { graceMs?: number; limit?: number; dryRun?: boolean; nowMs?: number } = {},
): Promise<{ deleted: string[]; objectErrors: string[] }> {
  const graceMs = opts.graceMs ?? UPLOAD_LIMITS.orphanGraceMs;
  const limit = opts.limit ?? 200;
  const nowMs = opts.nowMs ?? now();
  const db = await getDb();

  const candidates = await db.sql<Pick<FileRow, 'id' | 'storageKey'>>`
    SELECT f.id, f.storage_key FROM files f
    WHERE f.status = 'active' AND f.purpose <> 'submission' AND f.created_at < ${nowMs - graceMs}
      AND NOT EXISTS (SELECT 1 FROM lesson_files lf WHERE lf.file_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.cover_file_id = f.id)
    ORDER BY f.created_at, f.id LIMIT ${limit}`;

  const deleted: string[] = [];
  const objectErrors: string[] = [];
  for (const c of candidates) {
    if (opts.dryRun) {
      deleted.push(c.id);
      continue;
    }
    const done = await db.tx(async (sql) => {
      const [row] = await sql<{ status: string }>`SELECT status FROM files WHERE id = ${c.id} FOR UPDATE`;
      if (row?.status !== 'active') return false;
      const [used] = await sql`
        SELECT 1 WHERE EXISTS (SELECT 1 FROM lesson_files WHERE file_id = ${c.id})
                    OR EXISTS (SELECT 1 FROM courses WHERE cover_file_id = ${c.id})`;
      if (used) return false;
      await sql`UPDATE files SET status = 'deleted', deleted_at = ${now()} WHERE id = ${c.id}`;
      await writeAudit(sql, { actorId: null, action: 'file.purge', entity: 'file', entityId: c.id, meta: { reason: 'orphan' } });
      return true;
    });
    if (!done) continue;
    deleted.push(c.id);
    try {
      await getStorage().remove(c.storageKey);
    } catch {
      objectErrors.push(c.id);
    }
  }
  return { deleted, objectErrors };
}

/** Объекты в хранилище старше graceMs без активной строки files (в том числе у удалённых строк). */
export async function sweepStrayObjects(opts: { graceMs?: number; dryRun?: boolean } = {}): Promise<{ removed: string[] }> {
  const graceMs = opts.graceMs ?? UPLOAD_LIMITS.tempGraceMs;
  const db = await getDb();
  const storage = getStorage();
  const removed: string[] = [];
  const keys: string[] = [];
  for await (const o of storage.list(graceMs)) keys.push(o.key);
  for (const key of keys) {
    const [row] = await db.sql`
      SELECT 1 FROM files WHERE storage = ${storage.name} AND storage_key = ${key} AND status = 'active'`;
    if (row) continue;
    if (!opts.dryRun) await storage.remove(key);
    removed.push(key);
  }
  return { removed };
}

/** Временные файлы загрузки старше graceMs (оборванные загрузки). */
export async function sweepTemp(opts: { graceMs?: number } = {}): Promise<number> {
  return getStorage().removeStaleTemp(opts.graceMs ?? UPLOAD_LIMITS.tempGraceMs);
}
