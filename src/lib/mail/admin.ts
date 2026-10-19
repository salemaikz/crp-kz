// Страница «Письма» в админке: список и просмотр письма. Только для администратора.
// Ссылка с токеном действует как пароль, поэтому вне демо её нет ни в тексте, ни в ответе.
import { AdminError } from '../admin/errors';
import { assertAdmin, type Actor } from '../admin/guard';
import { getDb, now } from '../db';
import type { Locale } from '../content/types';
import { isDemo } from '../env';
import { isFeatureActive } from '../features';
import { mailLink } from './links';
import type { MailRow } from './outbox';
import { renderMail } from './render';
import { MAIL_TEMPLATES, type MailStatus, type MailTemplate } from './types';

export const MAIL_PAGE_SIZE = 50;
export const MAIL_STATUSES: readonly MailStatus[] = ['held', 'queued', 'sending', 'sent', 'failed', 'cancelled'];

/** Виден ли раздел «Письма»: достаточно любой активной почтовой функции. Единая точка для меню, страниц и действий. */
export function mailPagesActive(): boolean {
  return (['PASSWORD_RESET', 'EMAIL_VERIFY', 'REMINDERS'] as const).some((f) => isFeatureActive(f));
}

export type MailListRow = {
  id: string;
  createdAt: number;
  toEmail: string;
  template: MailTemplate;
  status: MailStatus;
  attempts: number;
  sentAt: number | null;
  locale: Locale;
};

export type MailView = MailListRow & {
  subject: string;
  /** Текстовая версия без ссылки с токеном. */
  text: string;
  lastError: string | null;
  /** Только в демо и только пока ссылка действует; иначе null. */
  demoLink: string | null;
};

/**
 * Ссылка с токеном для показа администратору: только в демо (реальных ящиков там нет, D-015)
 * и только пока ссылка действует. Вне демо она действует как пароль и не показывается.
 */
export function visibleDemoLink(row: MailRow, demo: boolean, nowMs: number): string | null {
  const live = row.secret !== null && row.secretExpiresAt !== null && row.secretExpiresAt > nowMs && row.status !== 'cancelled';
  return demo && live ? mailLink(row) : null;
}

async function guard(actor: Actor): Promise<void> {
  await assertAdmin(actor);
  if (!mailPagesActive()) throw new AdminError('FEATURE_DISABLED');
}

export async function listMail(
  actor: Actor,
  q: { status?: MailStatus | null; template?: MailTemplate | null; page?: number },
): Promise<{ rows: MailListRow[]; total: number }> {
  await guard(actor);
  const db = await getDb();
  // значения вне списков игнорируются: фильтр не доходит до SQL в виде произвольной строки
  const status = q.status && MAIL_STATUSES.includes(q.status) ? q.status : null;
  const template = q.template && MAIL_TEMPLATES.includes(q.template) ? q.template : null;
  // нецелое и огромное число (NaN, 1e300) не доходит до OFFSET
  const page = Number.isSafeInteger(q.page) && (q.page as number) >= 1 ? Math.min(q.page as number, 1e6) : 1;

  const [count] = await db.sql<{ n: number }>`
    SELECT count(*) AS n FROM mail_outbox
    WHERE (${status}::text IS NULL OR status = ${status}) AND (${template}::text IS NULL OR template = ${template})`;
  const rows = await db.sql<MailListRow>`
    SELECT id, created_at, to_email, template, status, attempts, sent_at, locale
    FROM mail_outbox
    WHERE (${status}::text IS NULL OR status = ${status}) AND (${template}::text IS NULL OR template = ${template})
    ORDER BY created_at DESC, id
    LIMIT ${MAIL_PAGE_SIZE} OFFSET ${(page - 1) * MAIL_PAGE_SIZE}`;
  return { rows, total: count?.n ?? 0 };
}

export async function getMailView(actor: Actor, id: string): Promise<MailView | null> {
  await guard(actor);
  const db = await getDb();
  const [r] = await db.sql<MailListRow & { params: Record<string, unknown>; secret: string | null; secretExpiresAt: number | null; lastError: string | null }>`
    SELECT id, created_at, to_email, template, status, attempts, sent_at, locale, params, secret, secret_expires_at, last_error
    FROM mail_outbox WHERE id = ${id}`;
  if (!r) return null;
  const row: MailRow = {
    id: r.id,
    template: r.template,
    locale: r.locale,
    toEmail: r.toEmail,
    params: r.params,
    secret: r.secret,
    secretExpiresAt: r.secretExpiresAt,
    status: r.status,
    createdAt: r.createdAt,
  };
  const rendered = renderMail(row, { hideSecretLink: true });
  return {
    id: r.id,
    createdAt: r.createdAt,
    toEmail: r.toEmail,
    template: r.template,
    status: r.status,
    attempts: r.attempts,
    sentAt: r.sentAt,
    locale: r.locale,
    subject: rendered.subject,
    text: rendered.text,
    lastError: r.lastError,
    demoLink: visibleDemoLink(row, isDemo(), now()),
  };
}
