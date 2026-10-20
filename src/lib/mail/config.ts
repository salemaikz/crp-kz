// Конфигурация почты (D-030). Письма из демо никогда не уходят наружу (D-009, D-015).
import { isDemo, type Env } from '../env';

export type MailTransportName = 'outbox' | 'smtp';

let warnedTransport = false;
let warnedRetention = false;

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

/**
 * Нижняя граница срока хранения писем. Защиту от повторных напоминаний держит dedupe_key письма:
 * удали строку раньше конца окна «срок прошёл» (30 дней) — следующий прогон крона поставит письмо
 * снова. Поэтому меньше 31 дня не храним, даже если так задано в окружении.
 */
export const MIN_MAIL_RETENTION_DAYS = 31;

/** Сколько дней хранить письма (не меньше MIN_MAIL_RETENTION_DAYS; меньшее значение — предупреждение). */
export function mailRetentionDays(env: Env = process.env): number {
  const days = positiveInt(env, 'MAIL_RETENTION_DAYS', 90);
  if (days < MIN_MAIL_RETENTION_DAYS && !warnedRetention) {
    warnedRetention = true;
    console.warn(`MAIL_RETENTION_DAYS=${days}: меньше ${MIN_MAIL_RETENTION_DAYS} нельзя, храним ${MIN_MAIL_RETENTION_DAYS}`);
  }
  return Math.max(MIN_MAIL_RETENTION_DAYS, days);
}
