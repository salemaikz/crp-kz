// Запись в журнал действий (audit_log). Вызывается внутри той же транзакции, что и сама правка.
import { newId, now, type Sql } from '../db';
import { jsonParam } from '../db/core';

export async function writeAudit(
  sql: Sql,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await sql`
    INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
    VALUES (${newId()}, ${actorId}, ${action}, ${entity}, ${entityId}, ${jsonParam(meta)}, ${now()})`;
}
