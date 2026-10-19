import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { AdminStat } from '@/components/admin/AdminStat';
import { AuditFeed } from '@/components/admin/AuditFeed';
import { Button, Card } from '@/components/ui';
import { getDashboardStats, listRecentAudit } from '@/lib/admin';
import { formatNumber } from '@/lib/format';
import { adminPage } from './_shared';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('dashboard') };
}

export default async function AdminDashboardPage({ params }: Props) {
  const { locale, user } = await adminPage(params, '/admin');
  const t = await getTranslations('admin.dashboard');
  const [stats, feed] = await Promise.all([getDashboardStats(user), listRecentAudit(user, 12)]);
  const n = (v: number) => formatNumber(v, locale);

  return (
    <>
      <AdminPageHead
        title={t('title')}
        lead={t('lead')}
        actions={
          <>
            <Button href="/courses" variant="ghost">
              {t('actions.catalog')}
            </Button>
            <Button href="/admin/courses/new" variant="primary">
              {t('actions.createCourse')}
            </Button>
          </>
        }
      />

      <section className="adm-stats" aria-label={t('statsLabel')}>
        <AdminStat value={n(stats.users)} label={t('stats.users')} href="/admin/users" testId="stat-users" />
        <AdminStat value={n(stats.publishedCourses)} label={t('stats.courses')} href="/admin/courses" testId="stat-courses" />
        <AdminStat value={n(stats.activeEnrollments)} label={t('stats.enrollments')} testId="stat-enrollments" />
        <AdminStat
          value={n(stats.pendingOrders)}
          label={t('stats.pending')}
          hint={t('stats.pendingHint')}
          href="/admin/orders"
          tone={stats.pendingOrders > 0 ? 'red' : 'ink'}
          testId="stat-pending"
        />
        <AdminStat value={n(stats.certificates)} label={t('stats.certificates')} testId="stat-certificates" />
      </section>

      <Card as="section" padding="lg" aria-labelledby="dash-feed">
        <header className="adm-card__head">
          <h2 id="dash-feed" className="h3">
            {t('feed.title')}
          </h2>
        </header>
        <AuditFeed items={feed} locale={locale} />
      </Card>
    </>
  );
}
