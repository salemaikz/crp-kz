// Переводчик писем: messages/{ru,kz}/mail.json подключаются напрямую, а не через NAMESPACES —
// письма собираются вне запроса (воркер, скрипты), клиенту эти тексты не нужны.
import { createTranslator } from 'next-intl';
import kz from '../../../messages/kz/mail.json';
import ru from '../../../messages/ru/mail.json';
import type { Locale } from '../content/types';

const MESSAGES = { ru, kz } as const;

/** Для Intl и правил множественного числа казахский — kk (D-002). */
const ICU_LOCALE: Record<Locale, string> = { ru: 'ru', kz: 'kk' };

export type MailT = (key: string, values?: Record<string, string | number>) => string;

/** Переводчик по ключам mail.json (например, 'password_reset.subject'). */
export function mailTranslator(locale: Locale): MailT {
  const t = createTranslator({ locale: ICU_LOCALE[locale], messages: MESSAGES[locale] });
  return (key, values) => (t as unknown as MailT)(key, values);
}
