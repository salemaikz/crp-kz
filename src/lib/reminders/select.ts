// Напоминания: чистый выбор, кому и о чём напомнить. Без БД и Next: тестируется напрямую.
// Нормативно: docs/lms/design/mail-account.md §3.7.
import type { TeamReportRow } from '../team/types';

const DAY_MS = 86_400_000;
/** Астана живёт по UTC+5 без перехода на летнее время. */
const ASTANA_OFFSET_MS = 5 * 3_600_000;

/** «Скоро срок» — те же 3 дня, что у dueStatus (today | soon). */
export const SOON_DAYS = 3;
/** «Просрочено» шлём, только если срок прошёл не более 30 дней назад: старые долги не рассылаем. */
export const OVERDUE_WINDOW_MS = 30 * DAY_MS;
/** Список в сводке руководителю: не больше строк каждого вида, остальное — в отчёте. */
export const DIGEST_LIMIT = 20;

export type LearnerReminder = { kind: 'due_soon' | 'overdue'; row: TeamReportRow; dedupeKey: string };

/**
 * Строки отчёта → напоминания сотрудникам. Только назначения (source = 'assignment') со сроком:
 * купленное и самостоятельное руководитель не назначал. today | soon → due_soon, overdue в окне
 * 30 дней → overdue; завершённые, с закрытым доступом и без срока статус отсекает сам. Ключ
 * идемпотентности привязан к сроку: продлили срок — новое напоминание.
 */
export function selectLearnerReminders(rows: readonly TeamReportRow[], nowMs: number): LearnerReminder[] {
  const out: LearnerReminder[] = [];
  for (const row of rows) {
    if (row.source !== 'assignment' || row.dueAt === null) continue;
    let kind: LearnerReminder['kind'] | null = null;
    if (row.status === 'today' || row.status === 'soon') kind = 'due_soon';
    else if (row.status === 'overdue' && nowMs - row.dueAt <= OVERDUE_WINDOW_MS) kind = 'overdue';
    if (kind) out.push({ kind, row, dedupeKey: `${kind}:${row.key}:${row.dueAt}` });
  }
  return out;
}

/** ISO-неделя по времени Астаны (UTC+5): '2026-W43'. Ключ раз-в-неделю для сводки руководителю. */
export function isoWeekKey(nowMs: number): string {
  const d = new Date(nowMs + ASTANA_OFFSET_MS);
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  // четверг этой недели определяет ISO-год
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dayFromMonday + 3);
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
