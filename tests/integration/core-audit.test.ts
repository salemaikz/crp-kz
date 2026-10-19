// Журнал действий: общий писатель (actor NULL допустим) и делегирование из admin/audit.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AUDIT_ACTIONS, writeAudit } from '../../src/lib/audit';
import { writeAudit as writeAdminAudit } from '../../src/lib/admin/audit';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  await db.close();
});

type Row = { actorId: string | null; action: string; entity: string; entityId: string; meta: Record<string, unknown>; createdAt: number };
const row = async (entityId: string) =>
  (await db.sql<Row>`SELECT actor_id, action, entity, entity_id, meta, created_at FROM audit_log WHERE entity_id = ${entityId}`)[0];

test('писатель без актора: система, крон и CLI пишут actor_id NULL', async () => {
  const t0 = Date.now();
  await writeAudit(db.sql, { actorId: null, action: 'reminders.run', entity: 'reminders', entityId: 'reminders', meta: { dueSoon: 2 } });
  const r = await row('reminders');
  assert.equal(r?.actorId, null);
  assert.equal(r?.action, 'reminders.run');
  assert.equal(r?.entity, 'reminders');
  assert.deepEqual(r?.meta, { dueSoon: 2 });
  assert.ok((r?.createdAt ?? 0) >= t0);
});

test('meta по умолчанию — пустой объект', async () => {
  await writeAudit(db.sql, { actorId: null, action: 'file.purge', entity: 'file', entityId: 'f-1' });
  assert.deepEqual((await row('f-1'))?.meta, {});
});

test('admin/audit сохраняет прежнюю сигнатуру и пишет ту же строку', async () => {
  await writeAdminAudit(db.sql, 'admin-1', 'course.create', 'course', 'c-1', { title: 'Курс' });
  const r = await row('c-1');
  assert.equal(r?.actorId, 'admin-1');
  assert.equal(r?.action, 'course.create');
  assert.equal(r?.entity, 'course');
  assert.deepEqual(r?.meta, { title: 'Курс' });
  await writeAdminAudit(db.sql, 'admin-1', 'module.delete', 'module', 'm-1');
  assert.deepEqual((await row('m-1'))?.meta, {});
});

test('запись идёт в транзакцию вызывающего и откатывается вместе с ней', async () => {
  await assert.rejects(
    db.tx(async (sql) => {
      await writeAudit(sql, { actorId: null, action: 'mail.fail', entity: 'mail', entityId: 'tx-1' });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(await row('tx-1'), undefined);
});

test('реестр: имена в два сегмента «сущность.глагол» без повторов', () => {
  assert.equal(new Set(AUDIT_ACTIONS).size, AUDIT_ACTIONS.length);
  for (const a of AUDIT_ACTIONS) assert.match(a, /^[a-z]+\.[a-z_]+$/, a);
});
