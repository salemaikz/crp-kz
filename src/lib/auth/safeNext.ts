// Защита ?next от открытого редиректа: только относительный путь этого сайта.

const BASE = 'http://local.invalid';

/** Нормализованный относительный путь (path+query+hash) или null, если значение небезопасно. */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  // обратный слэш, пробелы и управляющие символы браузеры трактуют по-своему (/\evil.com, /\t/evil.com)
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const out = `${url.pathname}${url.search}${url.hash}`;
  return out.startsWith('/') && !out.startsWith('//') ? out : null;
}

/**
 * Только путь, без query и фрагмента: для next, который сохраняется надолго (параметры письма).
 * В query бывают секреты страницы (ключ заказа ?key=…) — в БД и в письмо они не попадают.
 */
export function safeNextPath(next: unknown): string | null {
  const safe = safeNext(next);
  if (!safe) return null;
  return new URL(safe, BASE).pathname;
}
