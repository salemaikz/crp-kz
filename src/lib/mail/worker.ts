// Воркер очереди писем: захват пачки с арендой, отправка, повторы, очистка. Нормативно: mail §3.5, PLAN §2.2.
// Доставка «хотя бы один раз»: если процесс упал между ответом транспорта и UPDATE, после аренды
// письмо уйдёт повторно. В лог и в last_error адреса и тексты не попадают.
import { getDb, now } from '../db';
import { writeAudit } from '../audit';
import { mailFrom, mailReplyTo, mailRetentionDays } from './config';
import type { MailRow } from './outbox';
import { renderMail } from './render';
import type { MailTransport } from './transport';
import type { MailStatus, MailTemplate } from './types';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Паузы перед повторами после 1-й…4-й ошибки; пятая ошибка — письмо `failed`. Всего 5 попыток. */
export const RETRY_DELAYS_MS: readonly number[] = [MINUTE_MS, 5 * MINUTE_MS, 30 * MINUTE_MS, 2 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Аренда захваченного письма: воркер не вернулся за это время — письмо берётся снова. */
export const LEASE_MS = 5 * MINUTE_MS;
/** Токены хранятся ещё неделю после истечения: понятный ответ «ссылка устарела». */
const TOKEN_GRACE_MS = 7 * DAY_MS;

const SECRET_TEMPLATES: readonly MailTemplate[] = ['password_reset', 'email_verify'];

type ClaimedRow = MailRow & { attempts: number };

/**
 * Что записать после ошибки отправки: повтор с паузой или окончательный отказ. Чистая функция:
 * attempts — число попыток вместе с только что проваленной.
 */
export function nextAfterFailure(attempts: number, nowMs: number): { status: 'queued'; nextAttemptAt: number } | { status: 'failed' } {
  if (attempts >= MAX_ATTEMPTS) return { status: 'failed' };
  const delay = RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? MINUTE_MS;
  return { status: 'queued', nextAttemptAt: nowMs + delay };
}

/** Текст ошибки для last_error: без адресов и длинных токенов, не длиннее 500 знаков. */
export function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw
    .replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '[email]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export type DeliverResult = { sent: number; retried: number; failed: number; cancelled: number };

/**
 * Отправить пачку писем. Захват — одной командой с FOR UPDATE SKIP LOCKED: два воркера не берут
 * одно письмо. Нужен MAIL_FROM: без адреса отправителя письма не уходят.
 */
export async function deliverPending(opts: {
  transport: MailTransport;
  nowMs?: number;
  batch?: number;
  /** Часы для проверки аренды и отметок отправки; по умолчанию nowMs (фиксированные в тестах) или now(). */
  clock?: () => number;
}): Promise<DeliverResult> {
  const from = mailFrom();
  if (!from) throw new Error('MAIL_FROM не задан: письма не отправляются');
  const clock = opts.clock ?? (() => opts.nowMs ?? now());
  const t = opts.nowMs ?? clock();
  const batch = opts.batch ?? 20;
  const replyTo = mailReplyTo() ?? undefined;
  const db = await getDb();
  const lease = t + LEASE_MS;

  const claimedRaw = await db.sql<ClaimedRow>`
    UPDATE mail_outbox
    SET status = 'sending', attempts = attempts + 1, lease_until_at = ${lease}, updated_at = ${t}
    WHERE id IN (
      SELECT id FROM mail_outbox
      WHERE (status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ${t}))
         OR (status = 'sending' AND lease_until_at < ${t})
      ORDER BY created_at, id
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED)
    RETURNING id, template, locale, to_email, params, secret, secret_expires_at, status, created_at, attempts`;

  // RETURNING порядок не гарантирует: отправляем по времени создания
  const claimed = [...claimedRaw].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const result: DeliverResult = { sent: 0, retried: 0, failed: 0, cancelled: 0 };
  for (const row of claimed) {
    // перед каждой отправкой аренда проверяется и продлевается: пока шли предыдущие письма пачки, она
    // могла истечь, и письмо уже взял другой воркер. Тогда пропускаем: дубль не отправляем.
    const tn = clock();
    const owned = await db.sql`
      UPDATE mail_outbox SET lease_until_at = ${tn + LEASE_MS}
      WHERE id = ${row.id} AND status = 'sending' AND attempts = ${row.attempts} AND lease_until_at >= ${tn}
      RETURNING id`;
    if (owned.length === 0) continue;
    // обновления привязаны к номеру попытки: если аренда истекла и письмо взял другой воркер, наш
    // поздний ответ его состояние не затирает
    const dead =
      SECRET_TEMPLATES.includes(row.template) && (row.secret === null || (row.secretExpiresAt !== null && row.secretExpiresAt <= tn));
    if (dead) {
      // мёртвые ссылки не отправляем
      const done = await db.sql`
        UPDATE mail_outbox SET status = 'cancelled', secret = NULL, secret_expires_at = NULL, lease_until_at = NULL, updated_at = ${t}
        WHERE id = ${row.id} AND status = 'sending' AND attempts = ${row.attempts}
        RETURNING id`;
      if (done.length > 0) result.cancelled += 1;
      continue;
    }

    let providerId: string | null = null;
    let error: string | null = null;
    try {
      const mail = renderMail({ ...row, status: row.status as MailStatus });
      const res = await opts.transport.send({
        id: row.id,
        from,
        ...(replyTo ? { replyTo } : {}),
        to: row.toEmail,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      providerId = res.providerId ?? null;
    } catch (e) {
      error = sanitizeError(e);
    }

    const tf = clock(); // момент ответа транспорта: от него sent_at и паузы повтора
    if (error === null) {
      const done = await db.sql`
        UPDATE mail_outbox
        SET status = 'sent', sent_at = ${tf}, provider_id = ${providerId}, secret = NULL, secret_expires_at = NULL,
            lease_until_at = NULL, last_error = NULL, updated_at = ${tf}
        WHERE id = ${row.id} AND status = 'sending' AND attempts = ${row.attempts}
        RETURNING id`;
      if (done.length > 0) result.sent += 1;
      continue;
    }

    const next = nextAfterFailure(row.attempts, tf);
    if (next.status === 'queued') {
      const done = await db.sql`
        UPDATE mail_outbox
        SET status = 'queued', next_attempt_at = ${next.nextAttemptAt}, lease_until_at = NULL, last_error = ${error}, updated_at = ${tf}
        WHERE id = ${row.id} AND status = 'sending' AND attempts = ${row.attempts}
        RETURNING id`;
      if (done.length > 0) result.retried += 1;
      continue;
    }
    // окончательный отказ: секрет обнуляется, в журнал — id и шаблон, без адреса
    await db.tx(async (sql) => {
      const done = await sql`
        UPDATE mail_outbox
        SET status = 'failed', secret = NULL, secret_expires_at = NULL, next_attempt_at = NULL, lease_until_at = NULL,
            last_error = ${error}, updated_at = ${tf}
        WHERE id = ${row.id} AND status = 'sending' AND attempts = ${row.attempts}
        RETURNING id`;
      if (done.length === 0) return;
      result.failed += 1;
      await writeAudit(sql, {
        actorId: null,
        action: 'mail.fail',
        entity: 'mail',
        entityId: row.id,
        meta: { mailId: row.id, template: row.template },
        createdAt: tf,
      });
    });
  }
  return result;
}

/**
 * Очистка: письма старше MAIL_RETENTION_DAYS, токены, истёкшие более 7 дней назад, и секреты у писем
 * с истёкшей ссылкой (held и queued такие письма отменяются: без ссылки они бессмысленны). Письма,
 * которые прямо сейчас отправляются, не трогаем.
 */
export async function purgeMail(nowMs?: number): Promise<{ letters: number; tokens: number; secrets: number }> {
  const t = nowMs ?? now();
  const db = await getDb();
  const letters = await db.sql`
    DELETE FROM mail_outbox WHERE created_at < ${t - mailRetentionDays() * DAY_MS} AND status <> 'sending' RETURNING id`;
  const tokens = await db.sql`DELETE FROM auth_tokens WHERE expires_at < ${t - TOKEN_GRACE_MS} RETURNING id`;
  const secrets = await db.sql`
    UPDATE mail_outbox
    SET secret = NULL, secret_expires_at = NULL, updated_at = ${t},
        status = CASE WHEN status IN ('held', 'queued') THEN 'cancelled' ELSE status END
    WHERE secret IS NOT NULL AND secret_expires_at <= ${t} AND status <> 'sending'
    RETURNING id`;
  return { letters: letters.length, tokens: tokens.length, secrets: secrets.length };
}
