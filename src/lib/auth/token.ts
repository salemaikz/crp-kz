// Подпись значения cookie сессии: base64url(JSON {sid,uid,exp}) + '.' + base64url(HMAC-SHA256).
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SessionPayload = { sid: string; uid: string; exp: number };

const TOKEN_RE = /^[A-Za-z0-9_-]{1,700}\.[A-Za-z0-9_-]{43}$/;

function mac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify({ sid: payload.sid, uid: payload.uid, exp: payload.exp })).toString(
    'base64url',
  );
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

/** Проверяет подпись (сравнение за постоянное время) и срок. null — токен недействителен. */
export function verifySession(token: string | null | undefined, secret: string, nowMs = Date.now()): SessionPayload | null {
  if (!token || !TOKEN_RE.test(token)) return null;
  const dot = token.indexOf('.');
  const body = token.slice(0, dot);
  // У последнего символа base64url 32 байт 2 незначащих бита: разные строки декодируются в одни байты.
  // Поэтому сравниваем строки — вычисленную каноническую подпись с переданной, равной длины.
  const given = Buffer.from(token.slice(dot + 1), 'utf8');
  const expected = Buffer.from(mac(body, secret).toString('base64url'), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { sid, uid, exp } = data as Record<string, unknown>;
  if (typeof sid !== 'string' || typeof uid !== 'string' || typeof exp !== 'number') return null;
  if (!sid || !uid || !Number.isFinite(exp) || exp <= nowMs) return null;
  return { sid, uid, exp };
}
