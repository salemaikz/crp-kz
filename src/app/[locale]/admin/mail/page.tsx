import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { MailStatusBadge } from '@/components/admin/mail/MailStatusBadge';
import { RunRemindersButton } from '@/components/admin/mail/RunRemindersButton';
import '@/components/admin/mail/mail.css';
import { Alert, Button, Chip, EmptyState, Table, type TableColumn } from '@/components/ui';
import { isDemo } from '@/lib/env';
import { isFeatureActive } from '@/lib/features';
import { formatDate } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import {
  listMail,
  mailPagesActive,
  mailRetentionDays,
  mailTransportName,
  MAIL_PAGE_SIZE,
  MAIL_STATUSES,
  type MailListRow,
  type MailStatus,
} from '@/lib/mail';
import { runRemindersAction } from '@/lib/mail/adminActions';
import { adminPage, one, pageNumber } from '../_shared';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('mail'), robots: { index: false, follow: false } };
}

function href(status: string, page = 1): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/admin/mail?${qs}` : '/admin/mail';
}

/** Режим почты для подписи под заголовком: демо, очередь без отправки или внешний транспорт. */
function modeKey(): 'demo' | 'outbox' | 'smtp' {
  if (isDemo()) return 'demo';
  return mailTransportName() === 'smtp' ? 'smtp' : 'outbox';
}

/** Письма платформы: очередь и история. Раздел виден, пока активна любая почтовая функция. */
export default async function AdminMailPage({ params, searchParams }: Props) {
  if (!mailPagesActive()) notFound();
  const { locale, user } = await adminPage(params, '/admin/mail');
  const sp = await searchParams;
  const rawStatus = one(sp.status);
  const status = (MAIL_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as MailStatus) : null;
  const requestedPage = pageNumber(sp.page);

  const [t, first] = await Promise.all([
    getTranslations('admin.mail'),
    listMail(user, { status, page: requestedPage }),
  ]);
  const pages = Math.max(1, Math.ceil(first.total / MAIL_PAGE_SIZE));
  // страница за последней (письма удалили или ссылка устарела): показываем последнюю, а не «писем нет»
  const page = Math.min(requestedPage, pages);
  const list = page === requestedPage ? first : await listMail(user, { status, page });
  // «Писем пока нет» — только при пустой очереди; при пустом фильтре подпись другая
  const queueEmpty = list.rows.length === 0 && (status ? (await listMail(user, { page: 1 })).total === 0 : true);
  const mode = modeKey();

  const columns: TableColumn<MailListRow>[] = [
    {
      key: 'time',
      header: t('cols.time'),
      primary: true,
      cell: (m) => (
        <Link href={`/admin/mail/${m.id}`} className="adm-nowrap" data-testid="mail-open">
          {formatDate(m.createdAt, locale, { withTime: true, short: true, omitCurrentYear: true })}
        </Link>
      ),
    },
    { key: 'to', header: t('cols.to'), cell: (m) => <span className="adm-trunc" title={m.toEmail}>{m.toEmail}</span> },
    { key: 'letter', header: t('cols.letter'), cell: (m) => t(`template.${m.template}`) },
    { key: 'status', header: t('cols.status'), cell: (m) => <MailStatusBadge status={m.status} /> },
    { key: 'attempts', header: t('cols.attempts'), align: 'right', hideOnMobile: true, cell: (m) => m.attempts },
  ];

  return (
    <>
      <AdminPageHead
        title={t('title')}
        lead={t('lead')}
        actions={isFeatureActive('REMINDERS') ? <RunRemindersButton action={runRemindersAction.bind(null, locale)} /> : undefined}
      />
      <Alert tone="info" data-testid="mail-mode">
        {t(`mode.${mode}`, { days: mailRetentionDays() })}
      </Alert>

      <div className="adm-toolbar">
        <div className="adm-toolbar__chips" role="group" aria-label={t('filter.label')}>
          <Chip href={href('')} active={!status}>
            {t('filter.all')}
          </Chip>
          {MAIL_STATUSES.map((s) => (
            <Chip key={s} href={href(s)} active={status === s}>
              {t(`status.${s}`)}
            </Chip>
          ))}
        </div>
      </div>

      {list.rows.length === 0 ? (
        <EmptyState
          title={queueEmpty ? t('empty') : t('emptyFiltered')}
          action={
            status ? (
              <Button href="/admin/mail" variant="ghost">
                {t('reset')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="adm-count meta" aria-live="polite">
            {t('count', { count: list.total })}
          </p>
          <Table
            className="adm-table--trunc"
            columns={columns}
            rows={list.rows}
            rowKey={(m) => m.id}
            caption={<span className="visually-hidden">{t('table.caption')}</span>}
          />
          {pages > 1 && (
            <nav className="adm-pager" aria-label={t('pager.label')}>
              {page > 1 ? (
                <Button href={href(status ?? '', page - 1)} size="sm" variant="ghost">
                  {t('pager.prev')}
                </Button>
              ) : (
                <span />
              )}
              <span className="meta">{t('pager.page', { page, pages })}</span>
              {page < pages ? (
                <Button href={href(status ?? '', page + 1)} size="sm" variant="ghost">
                  {t('pager.next')}
                </Button>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
