// Сессии: строка в sessions (30 дней) + подписанная cookie crp_session. Нормативно: BUILD.md §5.
import { cookies } from 'next/headers';
import { seedId } from '../content/ids';
import { getDb, newId, now } from '../db';
import { isDemo, sessionSecret } from '../env';
import { signSession, verifySession } from './token';

export const SESSION_COOKIE = 'crp_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUserRow = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'author' | 'learner';
  locale: 'ru' | 'kz';
  /** users.email_verified_at заполнен (подтверждение по ссылке или сброс пароля, D-031). */
  emailVerified: boolean;
};

/** Пользователь из сида: id детерминирован от email (seedId('user', email)). */
export function isSeedUser(user: { id: string; email: string }): boolean {
  return user.id === seedId('user', user.email);
}

/** Создаёт строку сессии и возвращает подписанный токен для cookie. */
export async function createSessionToken(userId: string): Promise<{ token: string; expiresAt: number }> {
  const secret = sessionSecret(); // вне демо без секрета — ошибка, вход не работает
  const db = await getDb();
  const sid = newId();
  const t = now();
  const expiresAt = t + SESSION_TTL_MS;
  // заодно чистим истёкшие сессии этого пользователя
  await db.sql`DELETE FROM sessions WHERE user_id = ${userId} AND expires_at <= ${t}`;
  await db.sql`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${sid}, ${userId}, ${expiresAt}, ${t})`;
  return { token: signSession({ sid, uid: userId, exp: expiresAt }, secret), expiresAt };
}

/**
 * Пользователь по токену: подпись и срок, затем строка в sessions.
 * Демо-исключение: при isDemo() и только для пользователей сида — если строки нет
 * (новый экземпляр без памяти), а подпись верна, сессия создаётся заново.
 */
export async function resolveSessionToken(token: string | null | undefined): Promise<SessionUserRow | null> {
  if (!token) return null;
  const payload = verifySession(token, sessionSecret(), now());
  if (!payload) return null;
  const db = await getDb();
  const [row] = await db.sql<SessionUserRow & { userId: string; expiresAt: number }>`
    SELECT s.user_id, s.expires_at, u.id, u.email, u.name, u.role, u.locale,
           (u.email_verified_at IS NOT NULL) AS email_verified
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${payload.sid}`;
  if (row) {
    if (row.userId !== payload.uid || row.expiresAt <= now()) return null;
    return pickUser(row);
  }
  if (!isDemo()) return null;
  const [user] = await db.sql<SessionUserRow>`
    SELECT id, email, name, role, locale, (email_verified_at IS NOT NULL) AS email_verified
    FROM users WHERE id = ${payload.uid}`;
  if (!user || !isSeedUser(user)) return null;
  // срок восстановленной строки — не дальше обычного TTL от «сейчас», даже если exp в токене больше
  const t = now();
  const expiresAt = Math.min(payload.exp, t + SESSION_TTL_MS);
  await db.sql`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES (${payload.sid}, ${payload.uid}, ${expiresAt}, ${t})
    ON CONFLICT (id) DO NOTHING`;
  return pickUser(user);
}

/** Удаляет строку сессии по токену (подпись проверяется). */
export async function revokeSessionToken(token: string | null | undefined): Promise<void> {
  let payload = null;
  try {
    payload = token ? verifySession(token, sessionSecret(), now()) : null;
  } catch {
    return;
  }
  if (!payload) return;
  const db = await getDb();
  await db.sql`DELETE FROM sessions WHERE id = ${payload.sid}`;
}

function pickUser(r: SessionUserRow): SessionUserRow {
  return { id: r.id, email: r.email, name: r.name, role: r.role, locale: r.locale, emailVerified: r.emailVerified };
}

// ---------- Cookie (только в server actions и route handlers) ----------

function cookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  };
}

/** Начать сессию: новая строка в БД + cookie; прежняя сессия этого браузера удаляется. */
export async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  const { token, expiresAt } = await createSessionToken(userId);
  await revokeSessionToken(store.get(SESSION_COOKIE)?.value);
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

/** Завершить сессию: удалить строку и cookie. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  await revokeSessionToken(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
}

/** Текущий пользователь по cookie запроса или null. */
export async function readSessionUser(): Promise<SessionUserRow | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await resolveSessionToken(token);
  } catch (e) {
    // нет SESSION_SECRET вне демо и т. п. — гость, а не падение страницы
    console.error('[auth] session check failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
