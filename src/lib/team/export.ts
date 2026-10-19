// Выгрузка отчёта в CSV: проверка прав, те же фильтры, что в интерфейсе, запись в журнал.
import { isManagerOf } from '../auth';
import { getDb, newId, now } from '../db';
import { reportToCsv, type CsvLabels } from './csv';
import { buildTeamReport, filterReport, type ReportFilters } from './report';
import { TeamError } from './types';

export type ExportResult = { csv: string; rows: number };

/**
 * CSV отчёта организации. Только руководитель этой организации; в журнал — team.export
 * (кто выгрузил, сколько строк, с какими фильтрами): отчёт содержит email сотрудников.
 */
export async function exportTeamReport(input: {
  actorId: string;
  orgId: string;
  locale: string;
  labels: CsvLabels;
  filters?: ReportFilters;
  nowMs?: number;
}): Promise<ExportResult> {
  if (!(await isManagerOf(input.actorId, input.orgId))) throw new TeamError('forbidden');
  const nowMs = input.nowMs ?? now();
  const rows = filterReport(await buildTeamReport(input.orgId, nowMs), input.filters ?? {});
  const csv = reportToCsv(rows, input.labels, input.locale);

  const db = await getDb();
  await db.sql`
    INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
    VALUES (${newId()}, ${input.actorId}, 'team.export', 'organization', ${input.orgId},
            ${db.json({
              rows: rows.length,
              courseId: input.filters?.courseId ?? null,
              status: input.filters?.status ?? null,
            })}, ${nowMs})`;
  return { csv, rows: rows.length };
}
