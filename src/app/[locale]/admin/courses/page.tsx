import type { Metadata } from 'next';
import { GraduationCap, Plus, Search } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { Badge, Button, Chip, EmptyState, Input, Price, Table } from '@/components/ui';
import { listCourses, type CourseListItem, type CourseStatus } from '@/lib/admin';
import { t as l10n } from '@/lib/content/l10n';
import { formatDate } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { adminPage, one } from '../_shared';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('courses') };
}

function href(status: string, q: string): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const qs = params.toString();
  return qs ? `/admin/courses?${qs}` : '/admin/courses';
}

export default async function AdminCoursesPage({ params, searchParams }: Props) {
  const { locale, user } = await adminPage(params, '/admin/courses');
  const sp = await searchParams;
  const rawStatus = one(sp.status);
  const status: CourseStatus | '' = rawStatus === 'published' || rawStatus === 'draft' ? rawStatus : '';
  const q = one(sp.q).trim().slice(0, 100);

  const [t, tEnum, courses] = await Promise.all([
    getTranslations('admin.courses'),
    getTranslations('admin.enums'),
    listCourses(user, { status: status || undefined, q }),
  ]);
  const filtered = status !== '' || q !== '';

  const columns = [
    {
      key: 'title',
      header: t('table.title'),
      primary: true,
      width: '34%',
      cell: (c: CourseListItem) => (
        <div className="adm-cell-title">
          <Link href={`/admin/courses/${c.id}`} className="adm-cell-title__link">
            {l10n(c.title, locale)}
          </Link>
          <span className="meta">/{c.slug}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('table.status'),
      cell: (c: CourseListItem) => (
        <Badge tone={c.status === 'published' ? 'success' : 'neutral'} dot>
          {tEnum(`status.${c.status}`)}
        </Badge>
      ),
    },
    {
      key: 'visibility',
      header: t('table.visibility'),
      cell: (c: CourseListItem) => <Badge tone={c.visibility === 'public' ? 'info' : 'neutral'}>{tEnum(`visibility.${c.visibility}`)}</Badge>,
    },
    {
      key: 'price',
      header: t('table.price'),
      align: 'right' as const,
      cell: (c: CourseListItem) => <Price kzt={c.priceKzt} size="sm" />,
    },
    {
      key: 'lessons',
      header: t('table.lessons'),
      align: 'right' as const,
      cell: (c: CourseListItem) => <span className="adm-nowrap">{t('lessonsOf', { published: c.lessonsPublished, total: c.lessonsTotal })}</span>,
    },
    {
      key: 'students',
      header: t('table.students'),
      align: 'right' as const,
      cell: (c: CourseListItem) => c.enrollmentsActive,
    },
    {
      key: 'updated',
      header: t('table.updated'),
      hideOnMobile: true,
      cell: (c: CourseListItem) => <span className="meta adm-nowrap">{formatDate(c.updatedAt, locale, { short: true })}</span>,
    },
  ];

  return (
    <>
      <AdminPageHead
        eyebrow={t('eyebrow')}
        title={t('title')}
        lead={t('lead')}
        actions={
          <Button href="/admin/courses/new" variant="primary" data-testid="create-course">
            <Plus aria-hidden="true" />
            {t('create')}
          </Button>
        }
      />

      <div className="adm-toolbar">
        <div className="adm-toolbar__chips" role="group" aria-label={t('filter.label')}>
          <Chip href={href('', q)} active={status === ''}>
            {t('filter.all')}
          </Chip>
          <Chip href={href('published', q)} active={status === 'published'}>
            {t('filter.published')}
          </Chip>
          <Chip href={href('draft', q)} active={status === 'draft'}>
            {t('filter.draft')}
          </Chip>
        </div>
        <form method="get" role="search" className="adm-search" aria-label={t('search.label')}>
          {status && <input type="hidden" name="status" value={status} />}
          <div className="adm-search__field">
            <Search aria-hidden="true" />
            <Input name="q" defaultValue={q} placeholder={t('search.placeholder')} aria-label={t('search.label')} type="search" />
          </div>
          <Button type="submit" variant="dark" size="sm">
            {t('search.submit')}
          </Button>
        </form>
      </div>

      {courses.length === 0 ? (
        <EmptyState
          icon={<GraduationCap />}
          title={filtered ? t('empty.filteredTitle') : t('empty.title')}
          description={filtered ? t('empty.filteredText') : t('empty.text')}
          action={
            filtered ? (
              <Button href="/admin/courses" variant="ghost">
                {t('empty.reset')}
              </Button>
            ) : (
              <Button href="/admin/courses/new" variant="primary">
                <Plus aria-hidden="true" />
                {t('create')}
              </Button>
            )
          }
        />
      ) : (
        <Table columns={columns} rows={courses} rowKey={(c) => c.id} caption={<span className="visually-hidden">{t('table.caption')}</span>} />
      )}
    </>
  );
}
