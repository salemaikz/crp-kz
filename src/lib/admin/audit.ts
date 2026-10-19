// Запись в журнал действий (audit_log) от имени администратора. Вызывается внутри той же
// транзакции, что и сама правка. Вставку делает общий писатель src/lib/audit.ts.
import { writeAudit as write, type AuditAction, type AuditEntity } from '../audit';
import type { Sql } from '../db';

export async function writeAudit(
  sql: Sql,
  actorId: string,
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await write(sql, { actorId, action, entity, entityId, meta });
}
