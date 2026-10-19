// Ограничение частоты: скользящее окно в памяти процесса (вход, регистрация).
// На нескольких экземплярах лимит действует на каждый отдельно — для MVP достаточно.

type Store = Map<string, number[]>;
const g = globalThis as typeof globalThis & { __crpRateLimit?: Store };
const store: Store = (g.__crpRateLimit ??= new Map());

const MAX_KEYS = 50_000;

export type RateLimitResult = { ok: boolean; retryAfterMs: number };

/** Засчитывает попытку по ключу. ok=false — лимит исчерпан (попытка не засчитывается). */
export function rateLimit(key: string, limit: number, windowMs: number, nowMs = Date.now()): RateLimitResult {
  const from = nowMs - windowMs;
  const hits = (store.get(key) ?? []).filter((t) => t > from);
  if (hits.length >= limit) {
    store.set(key, hits);
    return { ok: false, retryAfterMs: (hits[0] as number) + windowMs - nowMs };
  }
  hits.push(nowMs);
  store.set(key, hits);
  if (store.size > MAX_KEYS) prune(nowMs, windowMs);
  return { ok: true, retryAfterMs: 0 };
}

/** Сбросить счётчик ключа (например, после успешного входа). */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

function prune(nowMs: number, windowMs: number): void {
  for (const [k, hits] of store) {
    if (!hits.length || (hits[hits.length - 1] as number) <= nowMs - windowMs) store.delete(k);
  }
  // всё ещё много — выбрасываем самые старые ключи
  for (const k of store.keys()) {
    if (store.size <= MAX_KEYS / 2) break;
    store.delete(k);
  }
}

/** Лимиты потоков авторизации. */
export const AUTH_LIMITS = {
  loginPerIpEmail: { limit: 8, windowMs: 15 * 60_000 },
  loginPerIp: { limit: 50, windowMs: 15 * 60_000 },
  registerPerIpEmail: { limit: 5, windowMs: 60 * 60_000 },
  registerPerIp: { limit: 20, windowMs: 60 * 60_000 },
} as const;
