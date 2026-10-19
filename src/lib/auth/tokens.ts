// Одноразовые токены ссылок: сброс пароля и подтверждение email.
// В БД лежит только SHA-256 токена; сырой токен живёт в письме (mail_outbox.secret до отправки).
// У токена 256 бит энтропии, поэтому медленный хеш и соль не нужны, а поиск идёт по UNIQUE token_hash.
import { createHash, randomBytes } from 'node:crypto';
import { newId, now, type Sql } from '../db';
import { cancelSecrets, checkAuthMailCaps, normalizeRecipient } from '../mail/outbox';

export type TokenKind = 'password_reset' | 'email_verify';

export const TOKEN_TTL_MS: Record<TokenKind, number> = {
  password_reset: 60 * 60_000, // 1 час
  email_verify: 72 * 60 * 60_000, // 3 дня
};

const SHAPE_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 случайных байта → base64url (43 знака) и SHA-256 hex (64 знака). */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Форма токена: отсекает мусор до запроса в БД. */
export function isTokenShape(raw: unknown): raw is string {
  return typeof raw === 'string' && SHAPE_RE.test(raw);
}

/**
 * Выдать токен. Вызывать в транзакции вместе с enqueueMail.
 * Порядок: блокировка строки пользователя (выдачи одного пользователя идут по очереди, иначе при
 * READ COMMITTED параллельные выдачи не видят токены друг друга и остаются живыми несколько ссылок),
 * проверка лимитов писем, гашение неиспользованных токенов этого вида и снятие их писем, вставка нового.
 * В auth_tokens пишется email из users, а не переданный: иначе другой регистр сломал бы consumeToken.
 * input.email сверяется с аккаунтом (без учёта регистра); расхождение — ошибка вызывающего.
 * null — сработал лимит писем (recipient_cap или global_cap): ничего не изменено, прежняя ссылка жива,
 * вызывающий ничего не отправляет и отвечает так же, как при успехе.
 */
export async function issueToken(
  sql: Sql,
  input: { userId: string; email: string; kind: TokenKind; nowMs?: number },
): Promise<{ raw: string; expiresAt: number } | null> {
  const t = input.nowMs ?? now();
  const [user] = await sql<{ email: string }>`SELECT email FROM users WHERE id = ${input.userId} FOR UPDATE`;
  if (!user) throw new Error('tokens: пользователь не найден');
  if (normalizeRecipient(user.email) !== normalizeRecipient(input.email)) throw new Error('tokens: адрес не совпадает с аккаунтом');
  if (await checkAuthMailCaps(sql, user.email, t)) return null;
  await sql`
    UPDATE auth_tokens SET used_at = ${t}
    WHERE user_id = ${input.userId} AND kind = ${input.kind} AND used_at IS NULL`;
  await cancelSecrets(sql, { userId: input.userId, template: input.kind, nowMs: t });
  const { raw, hash } = generateToken();
  const expiresAt = t + TOKEN_TTL_MS[input.kind];
  await sql`
    INSERT INTO auth_tokens (id, user_id, kind, token_hash, email, expires_at, created_at)
    VALUES (${newId()}, ${input.userId}, ${input.kind}, ${hash}, ${user.email}, ${expiresAt}, ${t})`;
  return { raw, expiresAt };
}

/**
 * Атомарно израсходовать токен. Порядок блокировок тот же, что у issueToken: сначала строка
 * пользователя (владелец токена, по token_hash) FOR UPDATE, затем UPDATE auth_tokens
 * … WHERE used_at IS NULL AND expires_at > now AND email = адрес аккаунта RETURNING. Обратный порядок
 * при параллельных выдаче и расходе давал взаимоблокировку. Адрес аккаунта сверяется с адресом при выдаче
 * в самом UPDATE: при расхождении токен не расходуется. null — токен неизвестен, использован, истёк,
 * другого вида или адрес аккаунта сменился. Вызывать в транзакции.
 */
export async function consumeToken(
  sql: Sql,
  raw: string,
  kind: TokenKind,
  nowMs?: number,
): Promise<{ userId: string; email: string } | null> {
  if (!isTokenShape(raw)) return null;
  const t = nowMs ?? now();
  const hash = hashToken(raw);
  const [owner] = await sql<{ id: string; email: string }>`
    SELECT u.id, u.email FROM users u
    JOIN auth_tokens a ON a.user_id = u.id
    WHERE a.token_hash = ${hash} AND a.kind = ${kind}
    FOR UPDATE OF u`;
  if (!owner) return null;
  const rows = await sql<{ id: string }>`
    UPDATE auth_tokens SET used_at = ${t}
    WHERE token_hash = ${hash} AND kind = ${kind} AND used_at IS NULL AND expires_at > ${t}
      AND user_id = ${owner.id} AND email = ${owner.email}
    RETURNING id`;
  return rows.length ? { userId: owner.id, email: owner.email } : null;
}
