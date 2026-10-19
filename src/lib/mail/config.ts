// Конфигурация почты (D-030). Письма из демо никогда не уходят наружу (D-009, D-015).
import { isDemo, type Env } from '../env';

export type MailTransportName = 'outbox' | 'smtp';

let warnedTransport = false;

/**
 * Демо — всегда 'outbox'. Иначе MAIL_TRANSPORT; сейчас принимается только 'outbox',
 * другое значение — предупреждение и 'outbox' (до задачи SMTP-адаптера).
 */
export function mailTransportName(env: Env = process.env): MailTransportName {
  if (isDemo(env)) return 'outbox';
  const raw = env.MAIL_TRANSPORT?.trim();
  if (raw && raw !== 'outbox' && !warnedTransport) {
    warnedTransport = true;
    console.warn('MAIL_TRANSPORT: поддерживается только outbox, письма наружу не уходят');
  }
  return 'outbox';
}

function text(env: Env, name: string): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const v = env[name]?.trim();
  if (!v || !/^\d+$/.test(v)) return fallback;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function mailFrom(env: Env = process.env): string | null {
  return text(env, 'MAIL_FROM');
}

export function mailReplyTo(env: Env = process.env): string | null {
  return text(env, 'MAIL_REPLY_TO');
}

/** Писем сброса пароля и подтверждения email на одного получателя в час. */
export const MAIL_AUTH_RECIPIENT_HOURLY = 5;

/** Общий предохранитель: писем категории auth в час на всех. */
export function mailAuthHourlyCap(env: Env = process.env): number {
  return positiveInt(env, 'MAIL_AUTH_HOURLY_CAP', 300);
}

/** Сколько дней хранить письма. */
export function mailRetentionDays(env: Env = process.env): number {
  return positiveInt(env, 'MAIL_RETENTION_DAYS', 90);
}
