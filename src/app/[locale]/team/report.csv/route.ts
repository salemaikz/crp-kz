// Выгрузка отчёта «Команды» в CSV (UTF-8 с BOM, разделитель «;» — открывается в Excel с русской локалью).
import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth';
import { routing } from '@/lib/i18n/routing';
import type { CsvLabels } from '@/lib/team/csv';
import { exportTeamReport } from '@/lib/team/export';
import { getManagedOrgs, pickOrg } from '@/lib/team/orgs';
import { parseStatusFilter } from '@/lib/team/report';
import type { TeamRowStatus } from '@/lib/team/types';

export const dynamic = 'force-dynamic';

const STATUSES: TeamRowStatus[] = ['done', 'overdue', 'today', 'soon', 'ok', 'nodue', 'revoked', 'expired'];

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = (routing.locales as readonly string[]).includes(raw) ? raw : routing.defaultLocale;

  // гость — 401; не руководитель — 404 (раздел «не существует»)
  const user = await getCurrentUser();
  if (!user) return text('Unauthorized', 401);
  const orgs = await getManagedOrgs(user.id);
  const url = new URL(request.url);
  const org = pickOrg(orgs, url.searchParams.get('org'));
  if (!org) return text('Not found', 404);

  const t = await getTranslations({ locale, namespace: 'team' });
  const labels: CsvLabels = {
    columns: {
      employee: t('csv.employee'),
      email: t('csv.email'),
      position: t('csv.position'),
      course: t('csv.course'),
      progress: t('csv.progress'),
      test: t('csv.test'),
      due: t('csv.due'),
      status: t('csv.status'),
      certificate: t('csv.certificate'),
    },
    status: Object.fromEntries(STATUSES.map((s) => [s, t(`status.${s}`)])) as CsvLabels['status'],
  };

  const { csv } = await exportTeamReport({
    actorId: user.id,
    orgId: org.orgId,
    locale,
    labels,
    filters: { courseId: url.searchParams.get('course'), status: parseStatusFilter(url.searchParams.get('status')) },
  });

  const date = new Date().toISOString().slice(0, 10);
  const slug = org.slug.replace(/[^a-z0-9_-]+/gi, '-'); // имя файла из БД: только безопасные символы
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="team-report-${slug}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
