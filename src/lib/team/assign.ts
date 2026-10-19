// Назначение курса сотрудникам. Все проверки — на сервере, до единой транзакции:
// руководитель этой организации → курс назначаемый → каждый сотрудник — член этой организации.
import { enroll, enrollmentState, type Enrollment } from '../access';
import { isManagerOf } from '../auth';
import { getDb, now } from '../db';
import { writeAudit } from '../audit';
import { listAssignableCourses } from './assignable';
import { TeamError } from './types';

/** Предел за одно назначение: защита от случайного «выбрать всех» в огромной организации. */
export const MAX_ASSIGN = 200;

export type AssignInput = {
  actorId: string;
  orgId: string;
  courseId: string;
  userIds: readonly string[];
  /** Конец срока сдачи (epoch-мс) или null — без срока. */
  dueAt?: number | null;
  nowMs?: number;
};

export type AssignResult = {
  courseId: string;
  /** Сотрудники, которым выдано или обновлено назначение. */
  assigned: string[];
  /** Пропущены: у них уже есть доступ по личной покупке или выдаче — назначение его не перепишет. */
  skipped: string[];
};

/**
 * Назначить курс сотрудникам организации (enroll source 'assignment' + срок + запись в журнале).
 * Всё или ничего: любая ошибка проверки отменяет назначение целиком.
 * Повторное назначение обновляет срок (enroll идемпотентен по паре «пользователь — курс»).
 */
export async function assignCourse(input: AssignInput): Promise<AssignResult> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) throw new TeamError('no_employees');
  if (userIds.length > MAX_ASSIGN) throw new TeamError('too_many');
  const nowMs = input.nowMs ?? now();
  const dueAt = input.dueAt ?? null;
  if (dueAt !== null && (!Number.isSafeInteger(dueAt) || dueAt <= nowMs)) throw new TeamError('due_past');

  const db = await getDb();
  return db.tx(async (sql) => {
    // 1. Руководитель именно этой организации (не любой организации и не просто админ)
    if (!(await isManagerOf(input.actorId, input.orgId))) throw new TeamError('forbidden');

    // 2. Курс из списка назначаемых этой организации
    const course = (await listAssignableCourses(input.orgId)).find((c) => c.id === input.courseId);
    if (!course) throw new TeamError('course_not_assignable');

    // 3. Каждый сотрудник — член этой организации (чужих и несуществующих не пропускаем)
    const members = await sql<{ userId: string }>`
      SELECT user_id FROM organization_members WHERE org_id = ${input.orgId} AND user_id = ANY(${userIds})`;
    if (members.length !== userIds.length) throw new TeamError('not_member');

    // 4. Личную покупку или выдачу админом назначение не перезаписывает (enroll заменил бы источник
    //    и привязал доступ к организации: уход из неё отозвал бы купленное)
    const existing = await sql<Enrollment>`
      SELECT * FROM enrollments WHERE course_id = ${course.id} AND user_id = ANY(${userIds})`;
    const own = new Set(
      existing
        .filter((e) => (e.source === 'purchase' || e.source === 'grant') && enrollmentState(e, nowMs).ok)
        .map((e) => e.userId),
    );

    const assigned: string[] = [];
    const skipped: string[] = [];
    for (const userId of userIds) {
      if (own.has(userId)) {
        skipped.push(userId);
        continue;
      }
      await enroll(
        {
          userId,
          courseId: course.id,
          source: 'assignment',
          orgId: input.orgId,
          grantedBy: input.actorId,
          dueAt,
          accessDays: course.accessDays,
        },
        sql,
      );
      assigned.push(userId);
    }

    await writeAudit(sql, {
      actorId: input.actorId,
      action: 'team.assign',
      entity: 'course',
      entityId: course.id,
      meta: { orgId: input.orgId, userIds: assigned, skipped, dueAt },
      createdAt: nowMs,
    });
    return { courseId: course.id, assigned, skipped };
  });
}
