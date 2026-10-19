// Типы почтового слоя (D-030). Реализация очереди, рендера и воркера — в задачах 1A и 4A.
// Нормативно: docs/lms/BUILD.md §5.
import type { L10n, Locale } from '../content/types';

export const MAIL_TEMPLATES = [
  'password_reset',
  'password_changed',
  'email_verify',
  'assignment_new',
  'due_soon',
  'overdue',
  'manager_digest',
] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

/** auth — письма с ссылками доступа (свои лимиты), notice — уведомления. */
export type MailCategory = 'auth' | 'notice';
export const MAIL_CATEGORY: Record<MailTemplate, MailCategory> = {
  password_reset: 'auth',
  password_changed: 'auth',
  email_verify: 'auth',
  assignment_new: 'notice',
  due_soon: 'notice',
  overdue: 'notice',
  manager_digest: 'notice',
};

/** held — сохранено без отправки (транспорт outbox); cancelled — ссылка истекла или погашена до отправки. */
export type MailStatus = 'held' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export type DigestItem = { name: string; courseTitle: L10n; dueAt: number };

/** Параметры шаблонов. Без секретов и ссылок: ссылки собирает только links.ts из siteUrl(). */
export type MailParams = {
  password_reset: { name: string };
  password_changed: { name: string; changedAt: number };
  email_verify: { name: string; next?: string | null };
  assignment_new: { name: string; courseSlug: string; courseTitle: L10n; dueAt: number | null };
  due_soon: { name: string; courseSlug: string; courseTitle: L10n; dueAt: number; progress: number };
  overdue: { name: string; courseSlug: string; courseTitle: L10n; dueAt: number; progress: number };
  manager_digest: {
    name: string;
    orgName: string;
    orgSlug: string;
    overdue: DigestItem[]; // не больше 20
    soon: DigestItem[]; // не больше 20
    overdueTotal: number;
    soonTotal: number;
  };
};

export type EnqueueInput<T extends MailTemplate = MailTemplate> = {
  template: T;
  locale: Locale;
  to: string;
  userId: string | null;
  params: MailParams[T];
  /** Только password_reset и email_verify. */
  secret?: { raw: string; expiresAt: number };
  dedupeKey?: string;
  nowMs?: number;
};

export type EnqueueResult =
  | { queued: true; id: string; status: 'held' | 'queued' }
  | { queued: false; reason: 'duplicate' | 'recipient_cap' | 'global_cap' };

export type RenderedMail = { subject: string; text: string; html: string };
