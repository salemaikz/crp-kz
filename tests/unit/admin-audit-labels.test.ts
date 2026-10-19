// У каждого нового действия журнала есть подпись в admin.json (ru и kz): иначе лента покажет «Действие: …».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AUDIT_ACTIONS } from '../../src/lib/audit';

type Tree = { [k: string]: Tree | string };
const load = (locale: string) =>
  (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'messages', locale, 'admin.json'), 'utf8')) as { audit: { actions: Tree } }).audit.actions;

const NEW_ACTIONS = AUDIT_ACTIONS.filter((a) =>
  /^(user\.(password_reset|email_verify|create_admin)|org\.|mail\.|reminders\.|file\.|course\.cover_)/.test(a),
);

test('новые действия журнала подписаны на ru и kz', () => {
  assert.ok(NEW_ACTIONS.length >= 14);
  for (const locale of ['ru', 'kz']) {
    const actions = load(locale);
    for (const a of NEW_ACTIONS) {
      const [entity, verb] = a.split('.') as [string, string];
      const label = (actions[entity] as Tree | undefined)?.[verb];
      assert.equal(typeof label, 'string', `${locale}: нет подписи ${a}`);
    }
  }
});
