import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Building2, KeyRound, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ActionButton } from '@/components/admin/ActionButton';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { GrantAccessForm, RoleForm } from '@/components/admin/UserForms';
import { Avatar, Badge, Card, EmptyState, Table, type BadgeTone } from '@/components/ui';
import { getUserDetail, listCourseOptions, type UserEnrollment } from '@/lib/admin';
import { grantAccessAction, changeRoleAction, revokeAccessAction } from '@/lib/admin/actions';
import { t as l10n } from '@/lib/content/l10n';
import { formatDate } from '@/lib/format';
import { adminPage } from '../../_shared';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('user') };
}

const STATE_TONE: Record<UserEnrollment['state'], BadgeTone> = { active: 'success', expired: 'warning', revoked: 'neutral' };

export default async function AdminUserPage({ params }: Props) {
  const { id } = await params;
  const { locale, user: admin } = await adminPage(params, `/admin/users/${id}`);

  const detail = await getUserDetail(admin, id);
  if (!detail) notFound();
  const { user, memberships, enrollments } = detail;

  const [t, tEnum, tc, tn, courses] = await Promise.all([
    getTranslations('admin.users.detail'),
    getTranslations('admin.enums'),
    getTranslations('common.a11y'),
    getTranslations('admin.shell'),
    listCourseOptions(admin),
  ]);
  const isSelf = user.id === admin.id;

  const columns = [
    {
      key: 'course',
      header: t('enrollments.course'),
      primary: true,
      cell: (e: UserEnrollment) => <strong>{l10n(e.courseTitle, locale)}</strong>,
    },
    {
      key: 'source',
      header: t('enrollments.source'),
      cell: (e: UserEnrollment) => (
        <span>
          {tEnum(`source.${e.source}`)}
          {e.orgName && <span className="meta"> · {e.orgName}</span>}
        </span>
      ),
    },
    {
      key: 'state',
      header: t('enrollments.state'),
      cell: (e: UserEnrollment) => (
        <Badge tone={STATE_TONE[e.state]} dot>
          {tEnum(`state.${e.state}`)}
        </Badge>
      ),
    },
    {
      key: 'expires',
      header: t('enrollments.expires'),
      cell: (e: UserEnrollment) => (
        <span>
          {e.expiresAt ? formatDate(e.expiresAt, locale, { short: true }) : t('enrollments.unlimited')}
          {e.dueAt && <span className="meta"> · {t('enrollments.due', { date: formatDate(e.dueAt, locale, { short: true }) })}</span>}
        </span>
      ),
    },
    {
      key: 'granted',
      header: t('enrollments.granted'),
      hideOnMobile: true,
      cell: (e: UserEnrollment) => (
        <span className="meta">
          {formatDate(e.createdAt, locale, { short: true })}
          {e.grantedByName && ` · ${e.grantedByName}`}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('enrollments.actions')}</span>,
      mobileLabel: t('enrollments.actions'),
      align: 'right' as const,
      cell: (e: UserEnrollment) =>
        e.state === 'revoked' ? null : (
          <ActionButton
            variant="text"
            tone="danger"
            action={revokeAccessAction.bind(null, locale, user.id, e.courseId)}
            label={t('enrollments.revoke')}
            confirm={t('enrollments.revokeConfirm', { course: l10n(e.courseTitle, locale) })}
            testId="revoke-access"
          />
        ),
    },
  ];

  return (
    <>
      <AdminPageHead
        breadcrumbs={{
          label: tc('breadcrumbs'),
          items: [{ label: tn('nav.users'), href: '/admin/users' }, { label: user.name || user.email }],
        }}
        title={
          <span className="adm-person adm-person--lg">
            <Avatar name={user.name || user.email} size="lg" />
            <span className="adm-person__text">
              <span>{user.name || user.email}</span>
            </span>
          </span>
        }
        meta={
          <>
            <span className="meta" data-testid="user-email">{user.email}</span>
            <Badge tone={user.role === 'admin' ? 'red' : user.role === 'author' ? 'info' : 'neutral'}>{tEnum(`role.${user.role}`)}</Badge>
            <span className="meta">{t('registered', { date: formatDate(user.createdAt, locale) })}</span>
            {!user.emailVerifiedAt && <Badge tone="warning">{t('emailUnverified')}</Badge>}
            {isSelf && <Badge tone="neutral">{t('you')}</Badge>}
          </>
        }
      />

      <div className="adm-cols">
        <Card as="section" padding="lg" aria-labelledby="u-role">
          <header className="adm-card__head">
            <h2 id="u-role" className="h3">
              <ShieldCheck aria-hidden="true" /> {t('role.title')}
            </h2>
            <p className="muted">{t(`role.hint.${user.role}`)}</p>
          </header>
          <RoleForm action={changeRoleAction.bind(null, locale, user.id)} current={user.role} self={isSelf} />
        </Card>

        <Card as="section" padding="lg" aria-labelledby="u-orgs">
          <header className="adm-card__head">
            <h2 id="u-orgs" className="h3">
              <Building2 aria-hidden="true" /> {t('orgs.title')}
            </h2>
          </header>
          {memberships.length === 0 ? (
            <p className="muted">{t('orgs.empty')}</p>
          ) : (
            <ul className="adm-orglist">
              {memberships.map((m) => (
                <li key={m.orgId}>
                  <strong>{m.orgName}</strong>
                  <span className="meta">
                    {tEnum(`orgRole.${m.role}`)}
                    {m.position ? ` · ${m.position}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section aria-labelledby="u-enr" className="adm-section">
        <header className="adm-card__head">
          <h2 id="u-enr" className="h3">
            <KeyRound aria-hidden="true" /> {t('enrollments.title')}
          </h2>
        </header>
        {enrollments.length === 0 ? (
          <EmptyState icon={<KeyRound />} title={t('enrollments.empty')} description={t('enrollments.emptyText')} headingLevel="h3" />
        ) : (
          <Table columns={columns} rows={enrollments} rowKey={(e) => e.id} caption={<span className="visually-hidden">{t('enrollments.title')}</span>} />
        )}
      </section>

      <Card as="section" padding="lg" aria-labelledby="u-grant">
        <header className="adm-card__head">
          <h2 id="u-grant" className="h3">
            {t('grant.title')}
          </h2>
          <p className="muted">{t('grant.lead')}</p>
        </header>
        <GrantAccessForm
          action={grantAccessAction.bind(null, locale, user.id)}
          courses={courses.map((c) => ({ id: c.id, title: l10n(c.title, locale), draft: c.status !== 'published' }))}
        />
      </Card>
    </>
  );
}
