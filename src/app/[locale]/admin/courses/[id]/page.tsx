import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { CourseForm, type CourseFormValues } from '@/components/admin/CourseForm';
import { CoverCard } from '@/components/admin/files/CoverCard';
import { ProgramTree } from '@/components/admin/ProgramTree';
import { Alert, Badge, Button, Card, Chip, Price } from '@/components/ui';
import { getCourse, getCourseStructure, listOrganizations } from '@/lib/admin';
import { deleteCourseAction, setCourseStatusAction, updateCourseAction } from '@/lib/admin/actions';
import { t as l10n } from '@/lib/content/l10n';
import { isDemo } from '@/lib/env';
import { isFeatureActive } from '@/lib/features';
import { listCourseFiles } from '@/lib/files/admin';
import { maxBytesFor, storageConfig } from '@/lib/storage/config';
import { formatDate, formatDuration } from '@/lib/format';
import { adminPage, one } from '../../_shared';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const t = await getTranslations({ locale: rawLocale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('course') };
}

export default async function AdminCoursePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { locale, user } = await adminPage(params, `/admin/courses/${id}`);
  const sp = await searchParams;
  const tab = one(sp.tab) === 'settings' ? 'settings' : 'program';

  const course = await getCourse(user, id);
  if (!course) notFound();

  const [t, tEnum, tc, tn, tf, modules, orgs] = await Promise.all([
    getTranslations('admin.course'),
    getTranslations('admin.enums'),
    getTranslations('common.a11y'),
    getTranslations('admin.shell'),
    getTranslations('files'),
    getCourseStructure(user, id),
    listOrganizations(user),
  ]);

  // загрузка файлов: флаг, хранилище и лимиты считает сервер, клиентские компоненты env не читают
  const uploadsEnabled = isFeatureActive('UPLOADS');
  const coverFileId = uploadsEnabled && tab === 'settings' ? ((await listCourseFiles(user, id)).find((f) => f.isCover)?.id ?? null) : null;

  const title = l10n(course.title, locale);
  const published = course.status === 'published';
  const inCatalog = published && course.visibility === 'public';
  const defaults: CourseFormValues = {
    titleRu: course.title.ru ?? '',
    titleKz: course.title.kz ?? '',
    summaryRu: course.summary.ru ?? '',
    summaryKz: course.summary.kz ?? '',
    descriptionRu: course.description.ru ?? '',
    descriptionKz: course.description.kz ?? '',
    slug: course.slug,
    level: course.level ?? '',
    durationMin: course.durationMin ? String(course.durationMin) : '',
    visibility: course.visibility,
    ownerOrgId: course.ownerOrgId ?? '',
    sequential: course.sequential,
    status: course.status,
    priceKzt: course.priceKzt ? String(course.priceKzt) : '',
    accessDays: course.accessDays ? String(course.accessDays) : '',
  };
  const hasData = course.ordersTotal + course.enrollmentsTotal + course.certificatesTotal > 0;

  return (
    <>
      <AdminPageHead
        breadcrumbs={{
          label: tc('breadcrumbs'),
          items: [{ label: tn('nav.courses'), href: '/admin/courses' }, { label: title }],
        }}
        title={title}
        actions={
          <>
            <ActionButton
              variant="text"
              tone={published ? 'default' : 'primary'}
              action={setCourseStatusAction.bind(null, locale, course.id, published ? 'draft' : 'published')}
              label={published ? t('actions.unpublish') : t('actions.publish')}
              testId="course-toggle-status"
            />
            {uploadsEnabled && (
              <Button href={`/admin/courses/${course.id}/files`} variant="ghost" size="sm" data-testid="course-files-link">
                {tf('library.link')}
              </Button>
            )}
            {inCatalog && (
              <Button href={`/courses/${course.slug}`} variant="ghost" size="sm">
                {t('actions.openCatalog')}
              </Button>
            )}
          </>
        }
        meta={
          <>
            <Badge tone={published ? 'success' : 'neutral'} dot>
              {tEnum(`status.${course.status}`)}
            </Badge>
            <Badge tone={course.visibility === 'public' ? 'info' : 'neutral'}>{tEnum(`visibility.${course.visibility}`)}</Badge>
            <Price kzt={course.priceKzt} size="sm" />
            <span className="meta">{t('meta.lessons', { published: course.lessonsPublished, total: course.lessonsTotal })}</span>
            {course.lessonsMinutes > 0 && <span className="meta">{formatDuration(course.lessonsMinutes, locale)}</span>}
            <span className="meta">{t('meta.students', { count: course.enrollmentsActive })}</span>
            <span className="meta">{t('meta.updated', { date: formatDate(course.updatedAt, locale, { withTime: true, short: true }) })}</span>
          </>
        }
      />

      {published && course.lessonsPublished === 0 && <Alert tone="warning">{t('warnNoLessons')}</Alert>}

      <div className="adm-tabs" role="group" aria-label={t('tabs.label')}>
        <Chip href={`/admin/courses/${course.id}`} active={tab === 'program'}>
          {t('tabs.program')}
        </Chip>
        <Chip href={`/admin/courses/${course.id}?tab=settings`} active={tab === 'settings'}>
          {t('tabs.settings')}
        </Chip>
      </div>

      {tab === 'program' ? (
        <ProgramTree courseId={course.id} modules={modules} locale={locale} />
      ) : (
        <>
          {uploadsEnabled && (
            <CoverCard
              locale={locale}
              courseId={course.id}
              coverFileId={coverFileId}
              limits={{ image: maxBytesFor('image'), document: maxBytesFor('document') }}
              storageOk={storageConfig().ok}
              demo={isDemo()}
            />
          )}
          <CourseForm
            key={course.status}
            mode="edit"
            action={updateCourseAction.bind(null, locale, course.id)}
            defaults={defaults}
            organizations={orgs.map((o) => ({ id: o.id, name: o.name }))}
            lessonsMinutes={course.lessonsMinutes}
            cancelHref={`/admin/courses/${course.id}`}
          />
          <Card as="section" padding="lg" tone="dashed" aria-labelledby="danger" className="adm-danger">
            <h2 id="danger" className="h3">
              {t('danger.title')}
            </h2>
            <p className="muted">{hasData ? t('danger.blocked') : t('danger.text')}</p>
            <ActionButton
              variant="text"
              tone="danger"
              action={deleteCourseAction.bind(null, locale, course.id)}
              label={t('danger.delete')}
              confirm={t('danger.confirm', { title })}
              disabled={hasData}
              disabledReason={t('danger.blocked')}
              testId="course-delete"
            />
          </Card>
        </>
      )}
    </>
  );
}
