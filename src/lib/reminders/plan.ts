// Формирование напоминаний: сотрудникам о сроках и сводка руководителям. Нормативно: mail §3.7.
// Данные берём из buildTeamReport(orgId): он уже учитывает завершение, отзыв, истечение доступа и текущее
// членство, поэтому изоляция организаций — тот же проверенный код. Получатели сводки — менеджеры
// этой же организации. Запуски идемпотентны (dedupe_key), параллельные запуски не дублируют письма.
import { getDb, now, type Sql } from '../db';
import { writeAudit } from '../audit';
import { isFeatureActive } from '../features';
import { enqueueMail } from '../mail/outbox';
import type { DigestItem } from '../mail/types';
import { buildTeamReport } from '../team/report';
import type { TeamReportRow } from '../team/types';
import { toL10n } from './l10n';
import { DIGEST_LIMIT, isoWeekKey, selectLearnerReminders, type LearnerReminder } from './select';

const HOUR_MS = 3_600_000;
/** Пока письмо «назначен курс» свежее 48 часов, «скоро срок» не дублирует его: срок там уже указан. */
const ASSIGNED_QUIET_MS = 48 * HOUR_MS;

export type PlanResult = { disabled: true } | { disabled: false; dueSoon: number; overdue: number; digests: number };

type Person = { id: string; email: string; name: string; locale: 'ru' | 'kz' };

function digestItems(rows: TeamReportRow[]): DigestItem[] {
  return rows
    .slice(0, DIGEST_LIMIT)
    .map((r) => ({ name: r.name, courseTitle: toL10n(r.courseTitle), dueAt: r.dueAt as number }));
}

/** Напоминания сотрудникам одной организации. Возвращает числа поставленных писем по видам. */
async function queueLearnerReminders(
  sql: Sql,
  reminders: LearnerReminder[],
  nowMs: number,
): Promise<{ dueSoon: number; overdue: number }> {
  const out = { dueSoon: 0, overdue: 0 };
  if (reminders.length === 0) return out;
  const people = await sql<Person>`
    SELECT id, email, name, locale FROM users WHERE id = ANY(${[...new Set(reminders.map((r) => r.row.userId))]})`;
  const byId = new Map(people.map((p) => [p.id, p]));

  // свежее «назначен курс» с тем же сроком уже сообщило срок
  const assignedKeys = reminders
    .filter((r) => r.kind === 'due_soon')
    .map((r) => `assigned:${r.row.key}:${r.row.dueAt}`);
  const quiet = new Set(
    assignedKeys.length === 0
      ? []
      : (
          await sql<{ dedupeKey: string }>`
            SELECT dedupe_key FROM mail_outbox
            WHERE dedupe_key = ANY(${assignedKeys}) AND created_at > ${nowMs - ASSIGNED_QUIET_MS}`
        ).map((r) => r.dedupeKey),
  );

  // единый порядок вставок (по ключу): параллельные прогоны берут блокировки в одном порядке
  const ordered = [...reminders].sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0));
  for (const r of ordered) {
    const person = byId.get(r.row.userId);
    if (!person) continue;
    if (r.kind === 'due_soon' && quiet.has(`assigned:${r.row.key}:${r.row.dueAt}`)) continue;
    const res = await enqueueMail(sql, {
      template: r.kind,
      locale: person.locale,
      to: person.email,
      userId: person.id,
      params: {
        name: person.name,
        courseSlug: r.row.courseSlug,
        courseTitle: toL10n(r.row.courseTitle),
        dueAt: r.row.dueAt as number,
        progress: r.row.progress,
      },
      dedupeKey: r.dedupeKey,
      nowMs,
    });
    if (res.queued) out[r.kind === 'due_soon' ? 'dueSoon' : 'overdue'] += 1;
  }
  return out;
}

/** Сводка каждому менеджеру организации раз в ISO-неделю (первым запуском недели). */
async function queueDigests(
  sql: Sql,
  org: { id: string; slug: string; name: string },
  rows: TeamReportRow[],
  nowMs: number,
): Promise<number> {
  const byDue = (a: TeamReportRow, b: TeamReportRow) => (a.dueAt as number) - (b.dueAt as number);
  const overdue = rows.filter((r) => r.status === 'overdue' && r.dueAt !== null).sort(byDue);
  const soon = rows.filter((r) => (r.status === 'today' || r.status === 'soon') && r.dueAt !== null).sort(byDue);
  if (overdue.length === 0 && soon.length === 0) return 0;

  const managers = await sql<Person>`
    SELECT u.id, u.email, u.name, u.locale
    FROM organization_members m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${org.id} AND m.role = 'manager'
    ORDER BY u.id`;
  const week = isoWeekKey(nowMs);
  let queued = 0;
  for (const m of managers) {
    const res = await enqueueMail(sql, {
      template: 'manager_digest',
      locale: m.locale,
      to: m.email,
      userId: m.id,
      params: {
        name: m.name,
        orgName: org.name,
        orgSlug: org.slug,
        overdue: digestItems(overdue),
        soon: digestItems(soon),
        overdueTotal: overdue.length,
        soonTotal: soon.length,
      },
      dedupeKey: `digest:${org.id}:${m.id}:${week}`,
      nowMs,
    });
    if (res.queued) queued += 1;
  }
  return queued;
}

/**
 * Сформировать напоминания по всем организациям. Флаг REMINDERS выключен — { disabled: true },
 * ничего не пишется. Транзакция на одну организацию. Журнал `reminders.run` пишется всегда, когда запуск
 * ручной (actorId — админ), и только при непустом результате у крона (actorId = NULL): пустые часовые
 * прогоны засоряли бы ленту.
 */
export async function planReminders(opts: { nowMs?: number; actorId: string | null }): Promise<PlanResult> {
  if (!isFeatureActive('REMINDERS')) return { disabled: true };
  const t = opts.nowMs ?? now();
  const db = await getDb();
  const orgs = await db.sql<{ id: string; slug: string; name: string }>`
    SELECT id, slug, name FROM organizations ORDER BY id`;

  const total = { dueSoon: 0, overdue: 0, digests: 0 };
  for (const org of orgs) {
    const rows = await buildTeamReport(org.id, t);
    const reminders = selectLearnerReminders(rows, t);
    const hasDigest = rows.some((r) => r.status === 'overdue' || r.status === 'today' || r.status === 'soon');
    if (reminders.length === 0 && !hasDigest) continue;
    await db.tx(async (sql) => {
      const learners = await queueLearnerReminders(sql, reminders, t);
      total.dueSoon += learners.dueSoon;
      total.overdue += learners.overdue;
      total.digests += await queueDigests(sql, org, rows, t);
    });
  }

  if (opts.actorId !== null || total.dueSoon + total.overdue + total.digests > 0) {
    await writeAudit(db.sql, {
      actorId: opts.actorId,
      action: 'reminders.run',
      entity: 'reminders',
      entityId: 'reminders',
      meta: { dueSoon: total.dueSoon, overdue: total.overdue, digests: total.digests },
      createdAt: t,
    });
  }
  return { disabled: false, ...total };
}
