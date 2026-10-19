// Содержимое писем по шаблонам: что сказать и куда вести. Верстку и экранирование делает layout.ts,
// ссылки — links.ts. Параметры приходят из jsonb, поэтому читаются осторожно.
import { CRP_CONTACTS } from '../brand';
import { t as l10n } from '../content/l10n';
import { daysUntil, formatDate } from '../format';
import { oneLine } from './layout';
import { mailLink } from './links';
import type { MailT } from './i18n';
import type { MailRow } from './outbox';

type L10nArg = Parameters<typeof l10n>[0];

export type MailContent = {
  subject: string;
  paragraphs: string[];
  lists: Array<{ title: string; items: string[]; note?: string }>;
  action: { label: string; href: string | null } | null;
  /** Абзацы после кнопки и ссылки («если это не вы…»). */
  after: string[];
};

const str = (v: unknown): string => (typeof v === 'string' ? oneLine(v) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

type DigestLine = { name: string; course: string; dueAt: number };

function digestLines(v: unknown, locale: MailRow['locale']): DigestLine[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).map((x) => {
    const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    return { name: str(o.name), course: oneLine(l10n(o.courseTitle as L10nArg, locale)), dueAt: num(o.dueAt) };
  });
}

/**
 * Содержимое письма. hideSecretLink — для показа в админке: ссылки с токеном не выводим вовсе
 * (они действуют как пароль), остальные ссылки остаются.
 */
export function buildContent(row: MailRow, t: MailT, opts: { hideSecretLink?: boolean } = {}): MailContent {
  const p = row.params;
  const locale = row.locale;
  const course = oneLine(l10n(p.courseTitle as L10nArg, locale));
  const dueAt = typeof p.dueAt === 'number' ? p.dueAt : null;
  // «сегодня» письма — день его создания: текст не меняется от того, когда его открыли
  const date = (ms: number) => formatDate(ms, locale, { omitCurrentYear: true, now: row.createdAt });
  const hide = opts.hideSecretLink === true && row.secret !== null;
  const link = hide ? null : mailLink(row);
  const action = (key: string) => ({ label: t(`${key}.action`), href: link });

  switch (row.template) {
    case 'password_reset':
      return {
        subject: t('password_reset.subject'),
        paragraphs: [t('password_reset.body')],
        lists: [],
        action: action('password_reset'),
        after: [t('password_reset.ignore')],
      };
    case 'password_changed':
      return {
        subject: t('password_changed.subject'),
        paragraphs: [
          t('password_changed.body', { date: formatDate(num(p.changedAt), locale, { withTime: true }) }),
          t('password_changed.notYou', { phone: CRP_CONTACTS.phone }),
        ],
        lists: [],
        action: action('password_changed'),
        after: [],
      };
    case 'email_verify':
      return {
        subject: t('email_verify.subject'),
        paragraphs: [t('email_verify.body')],
        lists: [],
        action: action('email_verify'),
        after: [t('email_verify.ignore')],
      };
    case 'assignment_new':
      return {
        subject: t('assignment_new.subject', { course }),
        paragraphs: [
          t('assignment_new.body', { course }),
          ...(dueAt !== null ? [t('assignment_new.due', { date: date(dueAt) })] : []),
        ],
        lists: [],
        action: action('assignment_new'),
        after: [],
      };
    case 'due_soon': {
      const due = num(p.dueAt);
      return {
        subject: t('due_soon.subject', { course, date: date(due) }),
        paragraphs: [t('due_soon.body', { days: Math.max(0, daysUntil(due, row.createdAt)), progress: num(p.progress) })],
        lists: [],
        action: action('due_soon'),
        after: [],
      };
    }
    case 'overdue': {
      const due = num(p.dueAt);
      return {
        subject: t('overdue.subject', { course }),
        paragraphs: [t('overdue.body', { date: date(due), progress: num(p.progress) })],
        lists: [],
        action: action('overdue'),
        after: [],
      };
    }
    case 'manager_digest': {
      const overdue = digestLines(p.overdue, locale);
      const soon = digestLines(p.soon, locale);
      const overdueTotal = Math.max(num(p.overdueTotal), overdue.length);
      const soonTotal = Math.max(num(p.soonTotal), soon.length);
      const list = (title: string, lines: DigestLine[], total: number) => ({
        title,
        items: lines.map((l) => t('manager_digest.line', { name: l.name, course: l.course, date: date(l.dueAt) })),
        ...(total > lines.length ? { note: t('manager_digest.more', { count: total - lines.length }) } : {}),
      });
      return {
        subject: t('manager_digest.subject', { org: str(p.orgName) }),
        paragraphs: [t('manager_digest.body', { overdue: overdueTotal, soon: soonTotal })],
        lists: [
          ...(overdue.length > 0 ? [list(t('manager_digest.overdueTitle'), overdue, overdueTotal)] : []),
          ...(soon.length > 0 ? [list(t('manager_digest.soonTitle'), soon, soonTotal)] : []),
        ],
        action: action('manager_digest'),
        after: [],
      };
    }
  }
}
