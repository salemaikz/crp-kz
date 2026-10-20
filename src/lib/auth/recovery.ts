// Сброс пароля и подтверждение email: логика без Next (тестируется напрямую).
// Нормативно: docs/lms/design/mail-account.md §3.3, §5; docs/lms/BUILD.md §5; D-031.
// Токены — tokens.ts, письма — mail/outbox.ts. Ссылки собирает только mail/links.ts.
import type { Locale } from '../content/types';
import { getDb, now, type Sql } from '../db';
import { writeAudit } from '../audit';
import { isDemo } from '../env';
import { isFeatureActive } from '../features';
import { cancelSecrets, checkAuthMailCaps, enqueueMail, normalizeRecipient } from '../mail/outbox';
import type { EnqueueResult } from '../mail/types';
import { consumeToken, issueToken } from './tokens';
import { safeNextPath } from './safeNext';
import { isSeedUser } from './session';

/** Внутренний сигнал: транзакция, единственная цель которой письмо, не поставила его — откатить. */
class MailNotQueued extends Error {}

/**
 * Аккаунт из сида в демо. В демо сессии сид-пользователей восстанавливаются по подписи cookie
 * (BUILD §5), поэтому «закрыть все сессии» для них невозможно, а общий демо-пароль не должен
 * меняться: публичное демо сломалось бы. Для таких аккаунтов сброс молча не выполняется.
 */
function isDemoSeedAccount(user: { id: string; email: string }): boolean {
  // критерий общий с восстановлением сессий (isSeedUser): иначе проверки разойдутся
  return isDemo() && isSeedUser(user);
}

/** Исход запроса ссылки. Публичная форма его скрывает (нет перечисления аккаунтов), админ видит причину. */
export type PasswordResetRequestResult =
  | { sent: true }
  | { sent: false; reason: 'not_found' | 'demo_seed' | 'rate_limited' | 'global_cap' | 'unavailable' };

/**
 * Запрос ссылки для смены пароля. Письмо уходит, только если аккаунт есть. Нет аккаунта, демо-аккаунт
 * сида в демо, сработал лимит писем, выключен флаг, письмо не встало в очередь — письма нет, причина
 * возвращается вызывающему. Публичное действие её не показывает (всегда «отправлено»): иначе форма
 * позволяла бы перечислять аккаунты. Вся работа — одна транзакция; если письмо не встало в очередь,
 * она откатывается и прежняя ссылка остаётся рабочей. actorId — админ, отправивший ссылку
 * (NULL — публичная форма). auditLink — админская отправка: запись user.password_reset_link делается в
 * той же транзакции, что и письмо (сбой записи откатывает и письмо). Причина global_cap — сработал общий
 * предохранитель писем со ссылками (признак атаки или сбоя); публичная форма её не показывает.
 */
export async function requestPasswordReset(input: {
  email: string;
  locale: Locale;
  actorId?: string | null;
  auditLink?: boolean;
  nowMs?: number;
}): Promise<PasswordResetRequestResult> {
  if (!isFeatureActive('PASSWORD_RESET')) return { sent: false, reason: 'unavailable' };
  const t = input.nowMs ?? now();
  const email = normalizeRecipient(input.email);
  const db = await getDb();
  try {
    return await db.tx(async (sql): Promise<PasswordResetRequestResult> => {
      const [user] = await sql<{ id: string; email: string; name: string }>`
        SELECT id, email, name FROM users WHERE email = ${email} FOR UPDATE`;
      if (!user) return { sent: false, reason: 'not_found' };
      if (isDemoSeedAccount(user)) return { sent: false, reason: 'demo_seed' };
      // причину лимита узнаём до issueToken (он различает отказы лишь как null); блокировка и подсчёт повторяются дёшево
      const cap = await checkAuthMailCaps(sql, user.email, t);
      if (cap) return { sent: false, reason: cap === 'global_cap' ? 'global_cap' : 'rate_limited' };
      const secret = await issueToken(sql, { userId: user.id, email: user.email, kind: 'password_reset', nowMs: t });
      if (!secret) return { sent: false, reason: 'rate_limited' }; // лимит писем: ничего не отправляем
      const res = await enqueueMail(sql, {
        template: 'password_reset',
        locale: input.locale,
        to: user.email,
        userId: user.id,
        params: { name: user.name },
        secret,
        capsChecked: true,
        nowMs: t,
      });
      if (!res.queued) throw new MailNotQueued();
      await writeAudit(sql, {
        actorId: input.actorId ?? null,
        action: 'user.password_reset_request',
        entity: 'user',
        entityId: user.id,
        createdAt: t,
      });
      if (input.auditLink) {
        await writeAudit(sql, {
          actorId: input.actorId ?? null,
          action: 'user.password_reset_link',
          entity: 'user',
          entityId: user.id,
          createdAt: t,
        });
      }
      return { sent: true };
    });
  } catch (e) {
    if (!(e instanceof MailNotQueued)) throw e;
    return { sent: false, reason: 'unavailable' };
  }
}

/**
 * Новый пароль по токену. Одна транзакция: токен, пароль, email_verified_at = COALESCE(…, now)
 * (владение почтой доказано), закрытие всех сессий пользователя, гашение прочих ссылок сброса, журнал,
 * письмо «пароль изменён». Хеш считается до транзакции (bcrypt долгий). Письмо о смене пароля не
 * откатывает смену, если не встало в очередь.
 */
export async function resetPassword(input: {
  token: string;
  passwordHash: string;
  nowMs?: number;
}): Promise<{ ok: true; userId: string } | { ok: false; reason: 'invalid_token' }> {
  const t = input.nowMs ?? now();
  const db = await getDb();
  return db.tx(async (sql) => {
    const tok = await consumeToken(sql, input.token, 'password_reset', t);
    if (!tok) return { ok: false, reason: 'invalid_token' } as const;
    // защита вторым слоем: токены демо-аккаунтам не выдаются; если такой всё же есть, он расходуется
    // (consumeToken выше), а пароль и сессии не трогаются
    if (isDemoSeedAccount({ id: tok.userId, email: tok.email })) return { ok: false, reason: 'invalid_token' } as const;
    const [user] = await sql<{ name: string; locale: Locale }>`
      UPDATE users SET password_hash = ${input.passwordHash}, email_verified_at = COALESCE(email_verified_at, ${t})
      WHERE id = ${tok.userId}
      RETURNING name, locale`;
    if (!user) return { ok: false, reason: 'invalid_token' } as const;
    await sql`DELETE FROM sessions WHERE user_id = ${tok.userId}`;
    await sql`
      UPDATE auth_tokens SET used_at = ${t}
      WHERE user_id = ${tok.userId} AND kind = 'password_reset' AND used_at IS NULL`;
    await cancelSecrets(sql, { userId: tok.userId, template: 'password_reset', nowMs: t });
    await writeAudit(sql, {
      actorId: tok.userId,
      action: 'user.password_reset',
      entity: 'user',
      entityId: tok.userId,
      createdAt: t,
    });
    await enqueueMail(sql, {
      template: 'password_changed',
      locale: user.locale,
      to: tok.email,
      userId: tok.userId,
      params: { name: user.name, changedAt: t },
      nowMs: t,
    });
    return { ok: true, userId: tok.userId } as const;
  });
}

/**
 * Письмо для подтверждения email. Вызывать в транзакции вызывающего (регистрация, повторная отправка).
 * Лимит писем сработал — { queued: false }, ссылка не выдана. Откат при queued: false — дело
 * вызывающего: у регистрации он не нужен, у повторной отправки (resendVerification) нужен.
 * Причина отказа при лимите всегда 'recipient_cap': issueToken не различает лимиты, а вызывающему
 * это не нужно.
 */
export async function sendVerification(
  sql: Sql,
  input: { userId: string; email: string; name: string; locale: Locale; next?: string | null; nowMs?: number },
): Promise<EnqueueResult> {
  const t = input.nowMs ?? now();
  const secret = await issueToken(sql, { userId: input.userId, email: input.email, kind: 'email_verify', nowMs: t });
  if (!secret) return { queued: false, reason: 'recipient_cap' };
  const res = await enqueueMail(sql, {
    template: 'email_verify',
    locale: input.locale,
    to: input.email,
    userId: input.userId,
    params: { name: input.name, next: safeNextPath(input.next) },
    secret,
    capsChecked: true,
    nowMs: t,
  });
  if (res.queued) {
    await writeAudit(sql, {
      actorId: input.userId,
      action: 'user.email_verify_request',
      entity: 'user',
      entityId: input.userId,
      createdAt: t,
    });
  }
  return res;
}

/**
 * Повторная отправка письма подтверждения вошедшему пользователю. Транзакция только ради письма:
 * не встало в очередь — откат, прежняя ссылка жива.
 */
export async function resendVerification(input: {
  userId: string;
  locale: Locale;
  next?: string | null;
  nowMs?: number;
}): Promise<{ ok: true; email: string } | { ok: false; reason: 'already_verified' | 'rate_limited' | 'not_found' }> {
  const db = await getDb();
  try {
    return await db.tx(async (sql) => {
      const [user] = await sql<{ id: string; email: string; name: string; verified: boolean }>`
        SELECT id, email, name, (email_verified_at IS NOT NULL) AS verified FROM users WHERE id = ${input.userId} FOR UPDATE`;
      if (!user) return { ok: false, reason: 'not_found' } as const;
      if (user.verified) return { ok: false, reason: 'already_verified' } as const;
      const res = await sendVerification(sql, {
        userId: user.id,
        email: user.email,
        name: user.name,
        locale: input.locale,
        next: input.next,
        nowMs: input.nowMs,
      });
      if (!res.queued) throw new MailNotQueued();
      return { ok: true, email: user.email } as const;
    });
  } catch (e) {
    if (e instanceof MailNotQueued) return { ok: false, reason: 'rate_limited' };
    throw e;
  }
}

/** Подтверждение email по токену. Вход не выполняется: ссылка из письма не становится ссылкой для входа. */
export async function verifyEmail(input: {
  token: string;
  nowMs?: number;
}): Promise<{ ok: true; userId: string } | { ok: false; reason: 'invalid_token' }> {
  const t = input.nowMs ?? now();
  const db = await getDb();
  return db.tx(async (sql) => {
    const tok = await consumeToken(sql, input.token, 'email_verify', t);
    if (!tok) return { ok: false, reason: 'invalid_token' } as const;
    await sql`UPDATE users SET email_verified_at = COALESCE(email_verified_at, ${t}) WHERE id = ${tok.userId}`;
    await writeAudit(sql, {
      actorId: tok.userId,
      action: 'user.email_verify',
      entity: 'user',
      entityId: tok.userId,
      createdAt: t,
    });
    return { ok: true, userId: tok.userId } as const;
  });
}
