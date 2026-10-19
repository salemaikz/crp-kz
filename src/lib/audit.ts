// Журнал действий (audit_log): общий писатель для всех зон. Нормативно: docs/lms/BUILD.md §3.
// Подписи для ленты в админке: messages/*/admin.json → audit.actions.<сущность>.<глагол>.
import { newId, now, type Sql } from './db';
import { jsonParam } from './db/core';

export type AuditEntity =
  | 'user'
  | 'course'
  | 'module'
  | 'lesson'
  | 'enrollment'
  | 'order'
  | 'certificate'
  | 'team'
  | 'org'
  | 'file'
  | 'mail'
  | 'reminders'
  | 'system';

/**
 * Реестр имён действий. Имя — строго «<сущность>.<глагол_snake>» в два сегмента: лента ищет подпись
 * по вложенному ключу, три сегмента сломали бы дерево ключей. Новое действие = строка здесь
 * и подписи ru/kz в admin.json. У действий не от пользователя своя сущность (reminders.run, mail.fail),
 * а не общая «system»: так сущность совпадает с первым сегментом имени.
 */
export const AUDIT_ACTIONS = [
  // курсы, программа, уроки (admin)
  'course.create',
  'course.update',
  'course.publish',
  'course.unpublish',
  'course.delete',
  'course.cover_set',
  'course.cover_clear',
  'module.create',
  'module.rename',
  'module.move',
  'module.delete',
  'lesson.create',
  'lesson.update',
  'lesson.move',
  'lesson.publish',
  'lesson.unpublish',
  'lesson.delete',
  // доступы, заказы, сертификаты, команда
  'enrollment.grant',
  'enrollment.revoke',
  'order.create',
  'order.paid',
  'order.cancel',
  'order.cancel_by_owner',
  'order.refund',
  'certificate.issue',
  'team.assign',
  'team.export',
  // пользователи
  'user.register',
  'user.role_change',
  'user.password_reset_request',
  'user.password_reset',
  'user.password_reset_link',
  'user.email_verify_request',
  'user.email_verify',
  'user.create_admin',
  // организации (CLI создания администратора)
  'org.create',
  'org.member_add',
  // почта, напоминания, файлы
  'mail.fail',
  'reminders.run',
  'file.upload',
  'file.delete',
  'file.purge',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Вставка в транзакции вызывающего. actorId NULL — система, крон, CLI.
 * В meta — id, коды, счётчики; без email, ФИО, телефонов и токенов.
 */
export async function writeAudit(
  sql: Sql,
  e: {
    actorId: string | null;
    action: AuditAction;
    entity: AuditEntity;
    entityId: string;
    meta?: Record<string, unknown>;
    /** Время записи (epoch-мс); по умолчанию now(). Нужно, когда операция живёт на своём «сейчас». */
    createdAt?: number;
  },
): Promise<void> {
  await sql`
    INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
    VALUES (${newId()}, ${e.actorId}, ${e.action}, ${e.entity}, ${e.entityId}, ${jsonParam(e.meta ?? {})}, ${e.createdAt ?? now()})`;
}
