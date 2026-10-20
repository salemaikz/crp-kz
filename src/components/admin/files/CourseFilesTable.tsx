import { getTranslations } from 'next-intl/server';
import { Table, type TableColumn } from '@/components/ui';
import { Link } from '@/lib/i18n/navigation';
import { t as l10n } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { deleteFileAction } from '@/lib/files/actions';
import type { CourseFileItem } from '@/lib/files/admin';
import { formatFileSize } from '@/lib/files/format';
import { formatDate } from '@/lib/format';
import { ActionButton } from '../ActionButton';
import { EXT_LABEL } from './uploadModel';
import './files.css';

type Props = { files: CourseFileItem[]; courseId: string; locale: Locale };

/** Таблица файлов курса: где используется и «Удалить» только у неиспользуемых (сервер проверяет ещё раз). */
export async function CourseFilesTable({ files, courseId, locale }: Props) {
  const t = await getTranslations('files');
  const units = { b: t('units.b'), kb: t('units.kb'), mb: t('units.mb'), gb: t('units.gb') };

  const columns: TableColumn<CourseFileItem>[] = [
    {
      key: 'name',
      header: t('library.columns.name'),
      primary: true,
      cell: (f) => (
        <a href={f.url} target="_blank" rel="noopener noreferrer" data-testid="file-name">
          {f.name}
        </a>
      ),
    },
    { key: 'type', header: t('library.columns.type'), cell: (f) => EXT_LABEL[f.ext] },
    { key: 'size', header: t('library.columns.size'), cell: (f) => formatFileSize(f.sizeBytes, locale, units) },
    {
      key: 'uploaded',
      header: t('library.columns.uploaded'),
      hideOnMobile: true,
      cell: (f) => [f.uploadedByName, formatDate(f.createdAt, locale, { short: true })].filter(Boolean).join(', '),
    },
    {
      key: 'usage',
      header: t('library.columns.usage'),
      cell: (f) => {
        const unused = f.usedIn.length === 0 && !f.isCover;
        if (unused) return <span className="muted">{t('library.unused')}</span>;
        return (
          <ul className="adm-files-uses">
            {f.isCover && <li>{t('library.cover')}</li>}
            {f.usedIn.map((u) => (
              <li key={u.lessonId}>
                <Link href={`/admin/courses/${courseId}/lessons/${u.lessonId}`}>{l10n(u.title, locale)}</Link>
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('library.delete')}</span>,
      mobileLabel: t('library.delete'),
      align: 'right',
      cell: (f) =>
        f.usedIn.length === 0 && !f.isCover ? (
          <ActionButton
            variant="text"
            tone="danger"
            label={t('library.delete')}
            confirm={t('library.deleteConfirm')}
            action={deleteFileAction.bind(null, locale, f.id)}
            testId="file-delete"
          />
        ) : null,
    },
  ];

  return <Table columns={columns} rows={files} rowKey={(f) => f.id} caption={<span className="visually-hidden">{t('library.title')}</span>} />;
}
