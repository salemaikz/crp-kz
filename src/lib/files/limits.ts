// Лимиты частоты загрузки и выдачи, счётчик одновременных загрузок (в памяти процесса, как у входа).
import { rateLimit } from '../auth/rateLimit';
import { UPLOAD_LIMITS } from '../storage/limits';

const g = globalThis as typeof globalThis & { __crpUploadSlots?: Map<string, number> };
const slots: Map<string, number> = (g.__crpUploadSlots ??= new Map());

/** Засчитывает загрузку пользователя; false — лимит окна исчерпан. */
export function allowUpload(userId: string): boolean {
  const { limit, windowMs } = UPLOAD_LIMITS.uploadsPerUser;
  return rateLimit(`upload:${userId}`, limit, windowMs).ok;
}

/** Слот одновременной загрузки: функция освобождения или null, если слотов нет. */
export function acquireUploadSlot(userId: string): (() => void) | null {
  const n = slots.get(userId) ?? 0;
  if (n >= UPLOAD_LIMITS.concurrentPerUser) return null;
  slots.set(userId, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = (slots.get(userId) ?? 1) - 1;
    if (cur <= 0) slots.delete(userId);
    else slots.set(userId, cur);
  };
}

/** Выдача: вошедший — лимит на пользователя, гость — на IP (или общее ведро при неизвестном IP). */
export function allowDownload(who: { userId: string } | { ip: string }): { ok: boolean; retryAfterMs: number } {
  if ('userId' in who) {
    const { limit, windowMs } = UPLOAD_LIMITS.downloadsPerUser;
    return rateLimit(`download:u:${who.userId}`, limit, windowMs);
  }
  const { limit, windowMs } = UPLOAD_LIMITS.downloadsPerIpGuest;
  return rateLimit(`download:ip:${who.ip}`, limit, windowMs);
}
