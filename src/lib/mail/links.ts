// Ссылки в письмах. Только отсюда и только из siteUrl(): ни Host запроса, ни params письма
// ссылок не несут. Токен — во фрагменте (#), чтобы он не попадал в логи прокси и заголовок Referer.
import { safeNext } from '../auth/safeNext';
import { siteUrl } from '../env';
import type { MailRow } from './outbox';

type LinkInput = Pick<MailRow, 'template' | 'locale' | 'secret' | 'params'>;

/** Строка из params или пустая: params приходят из jsonb, доверять форме нельзя. */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Абсолютная ссылка письма. null — ссылки нет: у письма с токеном его уже нет (отправлено,
 * истекло, снято) либо шаблон без ссылки.
 */
export function mailLink(row: LinkInput): string | null {
  const base = `${siteUrl()}/${row.locale}`;
  switch (row.template) {
    case 'password_reset':
      return row.secret ? `${base}/password/reset#token=${encodeURIComponent(row.secret)}` : null;
    case 'email_verify': {
      if (!row.secret) return null;
      const next = safeNext(row.params.next);
      return `${base}/account/verify#token=${encodeURIComponent(row.secret)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    }
    case 'password_changed':
      return `${base}/password/forgot`;
    case 'assignment_new':
    case 'due_soon':
    case 'overdue': {
      const slug = str(row.params.courseSlug);
      return slug ? `${base}/learn/${encodeURIComponent(slug)}` : null;
    }
    case 'manager_digest': {
      const org = str(row.params.orgSlug);
      return org ? `${base}/team?org=${encodeURIComponent(org)}&status=overdue` : null;
    }
  }
}
