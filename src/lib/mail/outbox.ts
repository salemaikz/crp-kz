// Очередь писем (outbox, D-030): вставка в транзакции вызывающего и снятие писем с секретами.
// Нормативно: docs/lms/design/PLAN.md §2.2.
import { newId, now, type Sql } from '../db';
import { jsonParam } from '../db/core';
import type { Locale } from '../content/types';
import { MAIL_RECIPIENT_LOCK_CLASS } from '../db/locks';
import { MAIL_AUTH_RECIPIENT_HOURLY, mailAuthHourlyCap, mailTransportName } from './config';
import { MAIL_CATEGORY, MAIL_TEMPLATES, type EnqueueInput, type EnqueueResult, type MailStatus, type MailTemplate } from './types';

const HOUR_MS = 3_600_000;

/** Шаблоны, письма которых несут одноразовую ссылку (секрет лежит в строке до отправки). */
const SECRET_TEMPLATES: readonly MailTemplate[] = ['password_reset', 'email_verify'];

/** Строка mail_outbox в том виде, в каком её читают рендер и ссылки. */
export type MailRow = {
  id: string;
  template: MailTemplate;
  locale: Locale;
  toEmail: string;
  params: Record<string, unknown>;
  /** Сырой токен ссылки; null — отправлено, истекло или снято. */
  secret: string | null;
  secretExpiresAt: number | null;
  status: MailStatus;
  createdAt: number;
};

/** Адрес получателя в хранимом виде: без пробелов и в нижнем регистре (иначе лимит обходят регистром). */
export function normalizeRecipient(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Лимиты писем категории auth. Лимит получателя (5 в час) считает только письма со ссылкой-секретом
 * (сброс пароля, подтверждение email): уведомление «пароль изменён» в него не входит, иначе пять запросов
 * сброса через публичную форму заняли бы все пять мест, и владелец не узнал бы о смене пароля.
 * Общий предохранитель считает все письма auth. Берёт advisory-блокировку на адрес до конца транзакции
 * (только если проверяется лимит получателя). Вызывается и из enqueueMail, и из issueToken (до гашения
 * прежних ссылок: при отказе у пользователя остаётся рабочая ссылка). Возвращает причину отказа или null.
 * Общий предохранитель мягкий: при гонке может быть превышен на число одновременных транзакций.
 */
export async function checkAuthMailCaps(
  sql: Sql,
  toRaw: string,
  nowMs: number,
  opts: { recipient?: boolean } = {},
): Promise<'recipient_cap' | 'global_cap' | null> {
  const to = normalizeRecipient(toRaw);
  const since = nowMs - HOUR_MS;
  if (opts.recipient !== false) {
    // двухключевая блокировка: класс из locks.ts, не пересекается с однопараметровыми ключами
    await sql`SELECT pg_advisory_xact_lock(${MAIL_RECIPIENT_LOCK_CLASS}::int, hashtext(${`mail:${to}`}))`;
    const [mine] = await sql<{ n: number }>`
      SELECT count(*) AS n FROM mail_outbox
      WHERE category = 'auth' AND template IN ('password_reset', 'email_verify')
        AND to_email = ${to} AND created_at > ${since}`;
    if ((mine?.n ?? 0) >= MAIL_AUTH_RECIPIENT_HOURLY) return 'recipient_cap';
  }
  const [all] = await sql<{ n: number }>`
    SELECT count(*) AS n FROM mail_outbox WHERE category = 'auth' AND created_at > ${since}`;
  if ((all?.n ?? 0) >= mailAuthHourlyCap()) {
    // без адреса и текста: в лог идёт только факт срабатывания
    console.error('mail: сработал общий предохранитель писем с ссылками, письмо не поставлено');
    return 'global_cap';
  }
  return null;
}

/**
 * Поставить письмо в очередь. Вызывать внутри транзакции действия, которое письмо вызвало.
 * Статус: транспорт outbox — 'held', иначе 'queued'. Для 'auth' действуют лимит получателя
 * (5 в час) и общий предохранитель (mailAuthHourlyCap() в час), см. checkAuthMailCaps; оба считаются
 * по самой таблице, поэтому работают на всех экземплярах.
 * Для писем со ссылкой токен выдают через issueToken, он сам проверяет лимиты до гашения прежних ссылок;
 * после его успеха вызывающий передаёт capsChecked: true, и лимиты здесь не перепроверяются. Иначе мягкий
 * общий предохранитель мог бы вернуть queued: false уже после гашения прежней ссылки.
 * Лимит получателя письма «пароль изменён» не касается (см. checkAuthMailCaps).
 */
export async function enqueueMail<T extends MailTemplate>(
  sql: Sql,
  input: EnqueueInput<T> & { capsChecked?: boolean },
): Promise<EnqueueResult> {
  if (!MAIL_TEMPLATES.includes(input.template)) throw new Error('mail: неизвестный шаблон');
  const needsSecret = SECRET_TEMPLATES.includes(input.template);
  if (needsSecret !== Boolean(input.secret)) {
    throw new Error(needsSecret ? 'mail: у шаблона со ссылкой нет секрета' : 'mail: секрет только у писем со ссылкой');
  }
  const t = input.nowMs ?? now();
  const to = normalizeRecipient(input.to);
  const category = MAIL_CATEGORY[input.template];

  if (category === 'auth' && !input.capsChecked) {
    const reason = await checkAuthMailCaps(sql, to, t, { recipient: SECRET_TEMPLATES.includes(input.template) });
    if (reason) return { queued: false, reason };
  }

  const status: 'held' | 'queued' = mailTransportName() === 'outbox' ? 'held' : 'queued';
  const id = newId();
  const rows = await sql<{ id: string }>`
    INSERT INTO mail_outbox (id, category, template, locale, user_id, to_email, params, secret, secret_expires_at,
                             dedupe_key, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (${id}, ${category}, ${input.template}, ${input.locale}, ${input.userId}, ${to},
            ${jsonParam(input.params)}, ${input.secret?.raw ?? null}, ${input.secret?.expiresAt ?? null},
            ${input.dedupeKey ?? null}, ${status}, 0, ${status === 'queued' ? t : null}, ${t}, ${t})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`;
  if (rows.length === 0) return { queued: false, reason: 'duplicate' };
  return { queued: true, id, status };
}

/**
 * Снять с отправки письма пользователя с секретами данного шаблона: secret = NULL,
 * held и queued становятся cancelled. Уже отправляемые (sending) не трогаем: воркер держит их
 * в памяти, а сам токен погашен отдельно. Возвращает число снятых писем.
 */
export async function cancelSecrets(
  sql: Sql,
  input: { userId: string; template: 'password_reset' | 'email_verify'; nowMs?: number },
): Promise<number> {
  const t = input.nowMs ?? now();
  const rows = await sql<{ id: string }>`
    UPDATE mail_outbox
    SET secret = NULL, secret_expires_at = NULL, status = 'cancelled', updated_at = ${t}
    WHERE user_id = ${input.userId} AND template = ${input.template}
      AND status IN ('held', 'queued') AND secret IS NOT NULL
    RETURNING id`;
  return rows.length;
}
