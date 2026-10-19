import type { Metadata } from 'next';
import { Search, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { Avatar, Badge, Button, Chip, EmptyState, Input, Table } from '@/components/ui';
import { listUsers, type UserListItem, type UserRole } from '@/lib/admin';
import { USER_ROLES } from '@/lib/admin/schemas';
import { formatDate } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { adminPage, one, pageNumber } from '../_shared';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 25;

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('users') };
}

function href(role: string, q: string, page = 1): string {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/admin/users?${qs}` : '/admin/users';
}

export default async function AdminUsersPage({ params, searchParams }: Props) {
  const { locale, user } = await adminPage(params, '/admin/users');
  const sp = await searchParams;
  const rawRole = one(sp.role);
  const role = (USER_ROLES as readonly string[]).includes(rawRole) ? (rawRole as UserRole) : undefined;
  const q = one(sp.q).trim().slice(0, 100);
  const page = pageNumber(sp.page);

  const [t, tEnum, list] = await Promise.all([
    getTranslations('admin.users'),
    getTranslations('admin.enums'),
    listUsers(user, { q, role, page, pageSize: PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const filtered = Boolean(role) || q !== '';

  const columns = [
    {
      key: 'name',
      header: t('table.name'),
      primary: true,
      cell: (u: UserListItem) => (
        <Link href={`/admin/users/${u.id}`} className="adm-person">
          <Avatar name={u.name || u.email} size="sm" />
          <span className="adm-person__text">
            <strong>{u.name || u.email}</strong>
            <span className="meta">{u.email}</span>
          </span>
        </Link>
      ),
    },
    {
      key: 'role',
      header: t('table.role'),
      cell: (u: UserListItem) => <Badge tone={u.role === 'admin' ? 'red' : u.role === 'author' ? 'info' : 'neutral'}>{tEnum(`role.${u.role}`)}</Badge>,
    },
    {
      key: 'orgs',
      header: t('table.orgs'),
      cell: (u: UserListItem) =>
        u.organizations.length === 0 ? (
          <span className="meta">—</span>
        ) : (
          <ul className="adm-orgs">
            {u.organizations.map((o) => (
              <li key={o.name}>
                {o.name}
                {o.role === 'manager' && <span className="meta"> · {tEnum('orgRole.manager')}</span>}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'enrollments',
      header: t('table.enrollments'),
      align: 'right' as const,
      cell: (u: UserListItem) => u.enrollmentsActive,
    },
    {
      key: 'created',
      header: t('table.created'),
      hideOnMobile: true,
      cell: (u: UserListItem) => <span className="meta adm-nowrap">{formatDate(u.createdAt, locale, { short: true })}</span>,
    },
  ];

  return (
    <>
      <AdminPageHead eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />

      <div className="adm-toolbar">
        <div className="adm-toolbar__chips" role="group" aria-label={t('filter.label')}>
          <Chip href={href('', q)} active={!role}>
            {t('filter.all')}
          </Chip>
          {USER_ROLES.map((r) => (
            <Chip key={r} href={href(r, q)} active={role === r}>
              {tEnum(`role.${r}`)}
            </Chip>
          ))}
        </div>
        <form method="get" role="search" className="adm-search" aria-label={t('search.label')}>
          {role && <input type="hidden" name="role" value={role} />}
          <div className="adm-search__field">
            <Search aria-hidden="true" />
            <Input name="q" defaultValue={q} placeholder={t('search.placeholder')} aria-label={t('search.label')} type="search" data-testid="user-search" />
          </div>
          <Button type="submit" variant="dark" size="sm">
            {t('search.submit')}
          </Button>
        </form>
      </div>

      {list.rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t('empty.title')}
          description={t('empty.text')}
          action={
            filtered ? (
              <Button href="/admin/users" variant="ghost">
                {t('empty.reset')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="adm-count meta" aria-live="polite">
            {t('count', { count: list.total })}
          </p>
          <Table columns={columns} rows={list.rows} rowKey={(u) => u.id} caption={<span className="visually-hidden">{t('table.caption')}</span>} />
          {pages > 1 && (
            <nav className="adm-pager" aria-label={t('pager.label')}>
              {page > 1 ? (
                <Button href={href(role ?? '', q, page - 1)} size="sm" variant="ghost">
                  {t('pager.prev')}
                </Button>
              ) : (
                <span />
              )}
              <span className="meta">{t('pager.page', { page, pages })}</span>
              {page < pages ? (
                <Button href={href(role ?? '', q, page + 1)} size="sm" variant="ghost">
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
