import { useTranslations } from 'next-intl';
import { Avatar, ProgressBar, Table, type TableColumn } from '@/components/ui';
import { t as pick } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { formatDate, relativeDue } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import type { TeamReportRow } from '@/lib/team/types';
import { StatusBadge } from './StatusBadge';
import './team.css';

type Props = { rows: TeamReportRow[]; locale: Locale; filtered: boolean };

/** Таблица отчёта: сотрудник, курс, прогресс, тест, срок со статусом, сертификат. На телефоне — карточки. */
export function ReportTable({ rows, locale, filtered }: Props) {
  const t = useTranslations('team.report');

  const columns: TableColumn<TeamReportRow>[] = [
    {
      key: 'employee',
      header: t('columns.employee'),
      primary: true,
      cell: (r) => (
        <span className="team-emp">
          <Avatar name={r.name} size="sm" />
          <span className="team-emp__text">
            <span className="team-emp__name">{r.name}</span>
            {r.position && <span className="team-emp__pos">{r.position}</span>}
          </span>
        </span>
      ),
    },
    {
      key: 'course',
      header: t('columns.course'),
      cell: (r) => <span className="team-course">{pick(r.courseTitle, locale)}</span>,
    },
    {
      key: 'progress',
      header: t('columns.progress'),
      cell: (r) => (
        <div className="team-progress">
          <ProgressBar
            size="sm"
            value={r.progress}
            label={t('lessons', { done: r.lessonsDone, total: r.lessonsTotal })}
            ariaLabel={`${t('columns.progress')}: ${r.name}, ${pick(r.courseTitle, locale)}`}
          />
        </div>
      ),
    },
    {
      key: 'test',
      header: t('columns.test'),
      cell: (r) =>
        r.quizScore === null ? (
          <span className="meta">{t('testNone')}</span>
        ) : (
          <span className="team-test">
            <strong>{r.quizScore}%</strong>
            <span className="meta">{t('testPassed', { passed: r.quizzesPassed, attempted: r.quizzesAttempted })}</span>
          </span>
        ),
    },
    {
      key: 'due',
      header: t('columns.due'),
      cell: (r) =>
        r.dueAt === null ? (
          <span className="meta">{t('noDue')}</span>
        ) : (
          <span className="team-due">
            <span>{formatDate(r.dueAt, locale, { short: true })}</span>
            {r.status !== 'done' && <span className="meta">{relativeDue(r.dueAt, locale)}</span>}
          </span>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'certificate',
      header: t('columns.certificate'),
      cell: (r) =>
        r.certificate ? (
          <Link href={`/cert/${r.certificate.number}`} className="text-link team-cert">
            {r.certificate.number}
          </Link>
        ) : (
          <span className="meta">{t('none')}</span>
        ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      empty={
        <div className="team-empty">
          <strong>{filtered ? t('emptyFilteredTitle') : t('emptyTitle')}</strong>
          <span>{filtered ? t('emptyFilteredText') : t('emptyText')}</span>
        </div>
      }
    />
  );
}
