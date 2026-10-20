// Сверка подготовленных согласий с токеном версий из формы. Общая для регистрации и заказа.
import { CONSENT_DOC, isLegalEnabled, type PreparedConsent } from '../legal';

/**
 * Версии, которые сервер подготовил к записи (prepareConsents), совпадают с токеном формы.
 * Токен сверялся до prepareConsents (consentTokenFresh); между ними версия могла вступить в силу
 * (граница effectiveFrom), и тогда пользователь принял бы текст, которого не видел. Формат
 * сравнения тот же, что у versionsToken: `${документ}@${версия}`, без дублей, по документам.
 * LEGAL неактивен — токена в форме нет, true.
 */
export function preparedMatchToken(prepared: readonly PreparedConsent[], token: unknown): boolean {
  if (!isLegalEnabled()) return true;
  if (typeof token !== 'string') return false;
  const versions = new Map<string, string>();
  for (const p of prepared) {
    const doc = CONSENT_DOC[p.kind];
    if (!doc) return false;
    versions.set(doc, p.version);
  }
  const actual = [...versions.keys()]
    .sort()
    .map((doc) => `${doc}@${versions.get(doc)}`)
    .join(';');
  return actual === token;
}
