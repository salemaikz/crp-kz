import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { CourseFilesTable } from '@/components/admin/files/CourseFilesTable';
import { Button, EmptyState } from '@/components/ui';
import { getCourse } from '@/lib/admin';
import { t as l10n } from '@/lib/content/l10n';
import { isFeatureActive } from '@/lib/features';
import { listCourseFiles, storageUsage } from '@/lib/files/admin';
import { formatFileSize } from '@/lib/files/format';
import { adminPage } from '../../../_shared';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'files.library' });
  return { title: t('title') };
}

export default async function AdminCourseFilesPage({ params }: Props) {
  const { id } = await params;
  // выключенная функция отвечает как несуществующая страница, без обращения к БД
  if (!isFeatureActive('UPLOADS')) notFound();
  const { locale, user } = await adminPage(params, `/admin/courses/${id}/files`);

  const course = await getCourse(user, id);
  if (!course) notFound();

  const [t, tc, tn, files, usage] = await Promise.all([
    getTranslations('files'),
    getTranslations('common.a11y'),
    getTranslations('admin.shell'),
    listCourseFiles(user, id),
    storageUsage(user, id),
  ]);
  const units = { b: t('units.b'), kb: t('units.kb'), mb: t('units.mb'), gb: t('units.gb') };
  const title = l10n(course.title, locale);

  return (
    <>
      <AdminPageHead
        breadcrumbs={{
          label: tc('breadcrumbs'),
          items: [
            { label: tn('nav.courses'), href: '/admin/courses' },
            { label: title, href: `/admin/courses/${course.id}` },
            { label: t('library.title') },
          ],
        }}
        title={t('library.title')}
        lead={
          <span className="adm-files-usage" data-testid="files-usage">
            {t('library.usage', {
              used: formatFileSize(usage.courseBytes, locale, units),
              total: formatFileSize(usage.courseQuota, locale, units),
            })}
          </span>
        }
        actions={
          <Button href={`/admin/courses/${course.id}`} variant="ghost" size="sm">
            {title}
          </Button>
        }
      />
      {files.length === 0 ? (
        <EmptyState title={t('library.empty')} />
      ) : (
        <CourseFilesTable files={files} courseId={course.id} locale={locale} />
      )}
    </>
  );
}
