import type { Metadata } from 'next';
import { ArrowRight, Award, ClipboardList, GraduationCap, KeyRound, Plus, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminPageHead } from '@/components/admin/AdminPageHead';
import { AuditFeed } from '@/components/admin/AuditFeed';
import { Button, Card, Stat } from '@/components/ui';
import { getDashboardStats, listRecentAudit } from '@/lib/admin';
import { formatNumber } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { adminPage } from './_shared';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale === 'kz' ? 'kz' : 'ru', namespace: 'admin.meta' });
  return { title: t('dashboard') };
}

function StatCard({
  icon,
  value,
  label,
  hint,
  href,
  tone,
  testId,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  hint?: string;
  href?: string;
  tone?: 'ink' | 'red';
  testId?: string;
}) {
  const body = (
    <>
      <span className="adm-stat__icon" aria-hidden="true">
        {icon}
      </span>
      <Stat value={value} label={label} hint={hint} tone={tone} />
    </>
  );
  return href ? (
    <Link href={href} className="card card--p-md card--interactive adm-stat adm-stat--link" data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className="card card--p-md adm-stat" data-testid={testId}>
      {body}
    </div>
  );
}

export default async function AdminDashboardPage({ params }: Props) {
  const { locale, user } = await adminPage(params, '/admin');
  const t = await getTranslations('admin.dashboard');
  const [stats, feed] = await Promise.all([getDashboardStats(user), listRecentAudit(user, 12)]);
  const n = (v: number) => formatNumber(v, locale);

  return (
    <>
      <AdminPageHead
        eyebrow={t('eyebrow')}
        title={t('title')}
        lead={t('lead')}
        actions={
          <Button href="/admin/courses/new" variant="primary">
            <Plus aria-hidden="true" />
            {t('quick.createCourse')}
          </Button>
        }
      />

      <section className="adm-stats" aria-label={t('statsLabel')}>
        <StatCard icon={<Users />} value={n(stats.users)} label={t('stats.users')} href="/admin/users" testId="stat-users" />
        <StatCard
          icon={<GraduationCap />}
          value={n(stats.publishedCourses)}
          label={t('stats.courses')}
          href="/admin/courses"
          testId="stat-courses"
        />
        <StatCard icon={<KeyRound />} value={n(stats.activeEnrollments)} label={t('stats.enrollments')} testId="stat-enrollments" />
        <StatCard
          icon={<ClipboardList />}
          value={n(stats.pendingOrders)}
          label={t('stats.pending')}
          hint={t('stats.pendingHint')}
          href="/admin/orders"
          tone={stats.pendingOrders > 0 ? 'red' : 'ink'}
          testId="stat-pending"
        />
        <StatCard icon={<Award />} value={n(stats.certificates)} label={t('stats.certificates')} testId="stat-certificates" />
      </section>

      <div className="adm-dash">
        <Card as="section" padding="lg" aria-labelledby="dash-feed">
          <header className="adm-card__head">
            <h2 id="dash-feed" className="h3">
              {t('feed.title')}
            </h2>
            <p className="muted">{t('feed.lead')}</p>
          </header>
          <AuditFeed items={feed} locale={locale} />
        </Card>

        <Card as="section" padding="lg" aria-labelledby="dash-quick" tone="night" className="adm-quick">
          <h2 id="dash-quick" className="h3">
            {t('quick.title')}
          </h2>
          <ul>
            <li>
              <Link href="/admin/courses/new" className="adm-quick__link">
                {t('quick.createCourse')} <ArrowRight aria-hidden="true" />
              </Link>
            </li>
            <li>
              <Link href="/admin/orders" className="adm-quick__link">
                {t('quick.orders')} <ArrowRight aria-hidden="true" />
              </Link>
            </li>
            <li>
              <Link href="/admin/users" className="adm-quick__link">
                {t('quick.users')} <ArrowRight aria-hidden="true" />
              </Link>
            </li>
            <li>
              <Link href="/courses" className="adm-quick__link">
                {t('quick.catalog')} <ArrowRight aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
