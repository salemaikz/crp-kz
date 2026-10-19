import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AssignForm } from '@/components/team/AssignForm';
import { OrgSwitcher } from '@/components/team/OrgSwitcher';
import { ReportFilters } from '@/components/team/ReportFilters';
import { ReportTable } from '@/components/team/ReportTable';
import { TeamStats } from '@/components/team/TeamStats';
import '@/components/team/team.css';
import { Button, Card, Container, PageHeader, Section } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { t as pick } from '@/lib/content/l10n';
import type { Locale } from '@/lib/content/types';
import { routing } from '@/lib/i18n/routing';
import { listAssignableCourses } from '@/lib/team/assignable';
import { MAX_ASSIGN } from '@/lib/team/assign';
import { getManagedOrgs, listMembers, orgLabel, pickOrg } from '@/lib/team/orgs';
import { buildTeamReport, filterReport, parseStatusFilter, STATUS_FILTERS, summarize } from '@/lib/team/report';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolveLocale(params: Props['params']): Promise<Locale> {
  const { locale: raw } = await params;
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'team.meta' });
  return { title: t('title'), description: t('description'), robots: { index: false, follow: false } };
}

/** Сегодняшняя дата в Астане для <input type="date" min>. */
function todayInAlmaty(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
}

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : null;
}

/** «Команда»: сводка, назначение курса, отчёт. Только для руководителей; остальным — 404. Шапка простая, на доске. */
export default async function TeamPage({ params, searchParams }: Props) {
  const locale = await resolveLocale(params);
  setRequestLocale(locale);
  const user = await requireUser(locale, `/${locale}/team`);

  // руководитель хотя бы одной организации; иначе страницы «не существует»
  const orgs = await getManagedOrgs(user.id);
  const sp = await searchParams;
  const org = pickOrg(orgs, sp.org);
  if (!org) notFound();

  const t = await getTranslations('team');
  const [members, assignable, allRows] = await Promise.all([
    listMembers(org.orgId),
    listAssignableCourses(org.orgId),
    buildTeamReport(org.orgId),
  ]);

  // фильтры: курс — только из строк отчёта, статус — из известных групп
  const reportCourses = [...new Map(allRows.map((r) => [r.courseId, pick(r.courseTitle, locale)])).entries()].map(
    ([id, title]) => ({ id, title }),
  );
  const courseParam = first(sp.course);
  const course = courseParam && reportCourses.some((c) => c.id === courseParam) ? courseParam : null;
  const status = parseStatusFilter(sp.status);
  const rows = filterReport(allRows, { courseId: course, status });
  const summary = summarize(allRows, members.length);

  const keepOrg = orgs.length > 1;
  const csvParams = new URLSearchParams();
  if (keepOrg) csvParams.set('org', org.slug);
  if (course) csvParams.set('course', course);
  if (status) csvParams.set('status', status);
  const csvQuery = csvParams.toString();
  const csvHref = `/${locale}/team/report.csv${csvQuery ? `?${csvQuery}` : ''}`;

  return (
    <>
      <PageHeader
        title={t('header.title')}
        lead={t('header.lead')}
        meta={orgs.length === 1 ? t('header.org', { name: orgLabel(org) }) : undefined}
        actions={<OrgSwitcher orgs={orgs} active={org.slug} label={t('header.orgLabel')} />}
      />

      <Section tone="board" spacing="tight">
        <Container className="team-page">
          <TeamStats summary={summary} />

          <Card large padding="lg" as="section" aria-labelledby="assign-title">
            <div className="team-block">
              <div className="team-block__copy">
                <h2 id="assign-title" className="display team-block__title">
                  {t('assign.title')}
                </h2>
                <p className="team-block__lead">{t('assign.lead')}</p>
              </div>
              <AssignForm
                orgId={org.orgId}
                employees={members.map((m) => ({ userId: m.userId, name: m.name, position: m.position }))}
                courses={assignable.map((c) => ({
                  id: c.id,
                  title: pick(c.title, locale),
                  group: c.visibility === 'internal' ? 'internal' : 'public',
                }))}
                minDate={todayInAlmaty()}
                maxAssign={MAX_ASSIGN}
              />
            </div>
          </Card>

          <section className="team-block" aria-labelledby="report-title">
            <div className="team-block__head">
              <div className="team-block__copy">
                <h2 id="report-title" className="display team-block__title">
                  {t('report.title')}
                </h2>
                <p className="team-block__lead">{t('report.lead')}</p>
              </div>
              <Button href={csvHref} external variant="ghost" size="sm" download>
                {t('report.export')}
              </Button>
            </div>
            <ReportFilters
              org={org.slug}
              keepOrg={keepOrg}
              courses={reportCourses}
              statuses={STATUS_FILTERS}
              course={course}
              status={status}
            />
            <p className="meta team-count" role="status">
              {t('report.count', { count: rows.length })}
            </p>
            <ReportTable rows={rows} locale={locale} filtered={Boolean(course || status)} />
          </section>
        </Container>
      </Section>
    </>
  );
}
