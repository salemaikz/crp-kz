import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNKNOWN_IP } from '../../src/lib/auth/clientIp';
import { rateLimit } from '../../src/lib/auth/rateLimit';
import { ORDER_LIMITS, orderAllowed } from '../../src/lib/orders/limits';

const T0 = 1_900_000_000_000;
let seq = 0;
const uniq = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

test('orderAllowed: исчерпанный лимит аккаунта не расходует ведро IP', () => {
  const ip = `10.1.0.${seq + 1}`;
  const spammer = uniq('spammer');
  for (let i = 0; i < ORDER_LIMITS.perUser.limit; i++) assert.equal(orderAllowed(spammer, ip, T0 + i), true);
  // дальше аккаунт упирается в свой лимит — сколько бы ни пытался
  for (let i = 0; i < 100; i++) assert.equal(orderAllowed(spammer, ip, T0 + 100 + i), false);
  // ведро IP потрачено только успешными попытками: соседи по адресу ещё могут заказать
  const rest = ORDER_LIMITS.perIp.limit - ORDER_LIMITS.perUser.limit;
  for (let i = 0; i < rest; i++) assert.equal(orderAllowed(uniq('neighbour'), ip, T0 + 300 + i), true, `сосед ${i}`);
  assert.equal(orderAllowed(uniq('neighbour'), ip, T0 + 400), false); // ведро IP исчерпано
});

test('orderAllowed: IP неизвестен — общего ведра нет, действует только лимит аккаунта', () => {
  // тысяча разных аккаунтов без известного IP не блокирует следующего покупателя
  for (let i = 0; i < 1000; i++) assert.equal(orderAllowed(uniq('bot'), UNKNOWN_IP, T0 + i), true);
  assert.equal(orderAllowed(uniq('buyer'), UNKNOWN_IP, T0 + 2000), true);
  // глобального ключа «order:unknown» больше нет
  assert.equal(rateLimit(`order:${UNKNOWN_IP}`, 1, 60_000, T0 + 3000).ok, true);
  // лимит аккаунта по-прежнему работает
  const user = uniq('user');
  for (let i = 0; i < ORDER_LIMITS.perUser.limit; i++) assert.equal(orderAllowed(user, UNKNOWN_IP, T0 + i), true);
  assert.equal(orderAllowed(user, UNKNOWN_IP, T0 + 50), false);
  assert.equal(orderAllowed(user, UNKNOWN_IP, T0 + ORDER_LIMITS.perUser.windowMs + 1), true); // окно прошло
});
