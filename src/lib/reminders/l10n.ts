// Заголовок курса в параметрах письма: из jsonb берём только строки ru и kz.
import type { L10n } from '../content/types';

export function toL10n(raw: unknown): L10n {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ru = typeof o.ru === 'string' ? o.ru : '';
  return typeof o.kz === 'string' && o.kz.trim() !== '' ? { ru, kz: o.kz } : { ru };
}
