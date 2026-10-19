import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { CourseForm, EMPTY_COURSE } from '@/components/admin/CourseForm';
import { listOrganizations } from '@/lib/admin';
import { createCourseAction } from '@/lib/admin/actions';
import { adminPage } from '../../_shared';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('newCourse') };
}

export default async function NewCoursePage({ params }: Props) {
  const { locale, user } = await adminPage(params, '/admin/courses/new');
  const [t, tc, orgs] = await Promise.all([
    getTranslations('admin.courseNew'),
    getTranslations('common.a11y'),
    listOrganizations(user),
  ]);
  const tn = await getTranslations('admin');

  return (
    <>
      <AdminPageHead
        breadcrumbs={{
          label: tc('breadcrumbs'),
          items: [{ label: tn('shell.nav.courses'), href: '/admin/courses' }, { label: t('crumb') }],
        }}
        title={t('title')}
        lead={t('lead')}
      />
      <CourseForm
        mode="create"
        action={createCourseAction.bind(null, locale)}
        defaults={EMPTY_COURSE}
        organizations={orgs.map((o) => ({ id: o.id, name: o.name }))}
        cancelHref="/admin/courses"
      />
    </>
  );
}
