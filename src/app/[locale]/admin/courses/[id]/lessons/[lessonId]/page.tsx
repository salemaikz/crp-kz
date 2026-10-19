import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { LessonEditor } from '@/components/admin/lesson/LessonEditor';
import { Badge, Button } from '@/components/ui';
import { getLessonForEdit } from '@/lib/admin';
import { saveLessonAction } from '@/lib/admin/actions';
import { t as l10n } from '@/lib/content/l10n';
import { adminPage } from '../../../../_shared';

type Props = { params: Promise<{ locale: string; id: string; lessonId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('lesson') };
}

export default async function AdminLessonPage({ params }: Props) {
  const { id, lessonId } = await params;
  const { locale, user } = await adminPage(params, `/admin/courses/${id}/lessons/${lessonId}`);

  const lesson = await getLessonForEdit(user, id, lessonId);
  if (!lesson) notFound();

  const [t, tc, tn, tEnum] = await Promise.all([
    getTranslations('admin.lessonEditor'),
    getTranslations('common.a11y'),
    getTranslations('admin.shell'),
    getTranslations('admin.enums'),
  ]);
  const courseTitle = l10n(lesson.courseTitle, locale);

  return (
    <>
      <AdminPageHead
        breadcrumbs={{
          label: tc('breadcrumbs'),
          items: [
            { label: tn('nav.courses'), href: '/admin/courses' },
            { label: courseTitle, href: `/admin/courses/${lesson.courseId}` },
            { label: l10n(lesson.title, locale) },
          ],
        }}
        title={l10n(lesson.title, locale)}
        actions={
          <Button href={`/admin/courses/${lesson.courseId}`} variant="ghost" size="sm">
            {t('back')}
          </Button>
        }
        meta={
          <>
            <Badge tone={lesson.status === 'published' ? 'success' : 'neutral'} dot>
              {tEnum(`status.${lesson.status}`)}
            </Badge>
            <span className="meta">{t('meta.module')}: {l10n(lesson.moduleTitle, locale)}</span>
          </>
        }
      />
      <LessonEditor
        initial={{
          titleRu: lesson.title.ru ?? '',
          titleKz: lesson.title.kz ?? '',
          slug: lesson.slug,
          durationMin: lesson.durationMin ? String(lesson.durationMin) : '',
          status: lesson.status,
          ru: lesson.content.ru?.blocks ?? [],
          kz: lesson.content.kz?.blocks ?? [],
        }}
        save={saveLessonAction.bind(null, locale, lesson.courseId, lesson.id)}
      />
    </>
  );
}
