// Письмо «вам назначен курс»: ставится в транзакции assignCourse, вместе с самим назначением.
import type { Sql } from '../db';
import { enqueueMail } from '../mail/outbox';
import { toL10n } from './l10n';

const DAY_MS = 86_400_000;
/** Писем «назначен курс» по одному назначению за сутки: частая смена срока не превращается в рассылку. */
export const ASSIGNMENT_MAILS_PER_DAY = 3;

/**
 * Поставить письма «назначен курс» сотрудникам, которым назначение выдано или обновлено.
 * Ключ идемпотентности — `assigned:{enrollmentId}:{dueAt|none}`: повтор с тем же сроком письма
 * не даёт, с новым сроком — даёт, но не больше ASSIGNMENT_MAILS_PER_DAY за сутки на одно назначение
 * (сам срок при этом обновляется, молчит только письмо). Вызывающий проверяет флаг REMINDERS. Возвращает число поставленных.
 */
export async function queueAssignmentNotices(
  sql: Sql,
  input: { orgId: string; courseId: string; userIds: readonly string[]; dueAt: number | null; nowMs: number },
): Promise<number> {
  if (input.userIds.length === 0) return 0;
  const people = await sql<{ enrollmentId: string; userId: string; email: string; name: string; locale: 'ru' | 'kz' }>`
    SELECT e.id AS enrollment_id, u.id AS user_id, u.email, u.name, u.locale
    FROM enrollments e
    JOIN users u ON u.id = e.user_id
    JOIN organization_members m ON m.user_id = e.user_id AND m.org_id = ${input.orgId}
    WHERE e.course_id = ${input.courseId} AND e.org_id = ${input.orgId} AND e.source = 'assignment'
      AND e.user_id = ANY(${[...input.userIds]})
    ORDER BY u.id`;
  if (people.length === 0) return 0;
  const [course] = await sql<{ slug: string; title: unknown }>`SELECT slug, title FROM courses WHERE id = ${input.courseId}`;
  if (!course) return 0;

  // уже поставленные за сутки письма по этим назначениям (ключ начинается с assigned:{id}:)
  const prefixes = people.map((p) => `assigned:${p.enrollmentId}:`);
  const recent = await sql<{ prefix: string; n: number }>`
    SELECT left(dedupe_key, length(dedupe_key) - length(split_part(dedupe_key, ':', 3))) AS prefix, count(*) AS n
    FROM mail_outbox
    WHERE template = 'assignment_new' AND created_at > ${input.nowMs - DAY_MS}
      AND left(dedupe_key, length(dedupe_key) - length(split_part(dedupe_key, ':', 3))) = ANY(${prefixes})
    GROUP BY 1`;
  const sentToday = new Map(recent.map((r) => [r.prefix, Number(r.n)]));

  let queued = 0;
  for (const p of people) {
    if ((sentToday.get(`assigned:${p.enrollmentId}:`) ?? 0) >= ASSIGNMENT_MAILS_PER_DAY) continue;
    const res = await enqueueMail(sql, {
      template: 'assignment_new',
      locale: p.locale,
      to: p.email,
      userId: p.userId,
      params: { name: p.name, courseSlug: course.slug, courseTitle: toL10n(course.title), dueAt: input.dueAt },
      dedupeKey: `assigned:${p.enrollmentId}:${input.dueAt ?? 'none'}`,
      nowMs: input.nowMs,
    });
    if (res.queued) queued += 1;
  }
  return queued;
}
