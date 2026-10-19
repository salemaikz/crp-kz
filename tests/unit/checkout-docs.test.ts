import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canViewOrder, orderAccessKey, verifyOrderAccessKey } from '../../src/lib/orders/access-key';
import { formatOrderNumber, isOrderNumber, orderNumberPrefix } from '../../src/lib/orders/number';
import { amountInWords, numberInWords } from '../../src/lib/orders/words';

test('номер заказа: CRP-ГГММДД-NNNN по дате Астаны', () => {
  // 18.10.2026 20:00 UTC — в Астане уже 19 октября
  const t = Date.UTC(2026, 9, 18, 20, 0);
  assert.equal(orderNumberPrefix(t), 'CRP-261019-');
  assert.equal(formatOrderNumber(t, 7), 'CRP-261019-0007');
  assert.equal(formatOrderNumber(t, 9999), 'CRP-261019-9999');
  assert.match(formatOrderNumber(Date.now(), 1234), /^CRP-\d{6}-1234$/);
});

test('isOrderNumber: наш формат и демо-заказы, остальное — нет', () => {
  assert.equal(isOrderNumber('CRP-261019-0007'), true);
  assert.equal(isOrderNumber('DEMO-1002'), true);
  for (const bad of ['', 'CRP-261019-007', 'crp-261019-0007', 'CRP-261019-0007/../x', "DEMO-1'", 'ORDER-1']) {
    assert.equal(isOrderNumber(bad), false, bad);
  }
});

test('ключ доступа к заказу: стабилен, привязан к заказу, неверный — отказ', () => {
  const key = orderAccessKey('order-1');
  assert.equal(key.length, 32);
  assert.match(key, /^[A-Za-z0-9_-]+$/);
  assert.equal(orderAccessKey('order-1'), key);
  assert.notEqual(orderAccessKey('order-2'), key);
  assert.equal(verifyOrderAccessKey('order-1', key), true);
  assert.equal(verifyOrderAccessKey('order-2', key), false);
  assert.equal(verifyOrderAccessKey('order-1', key.slice(0, 31) + (key.endsWith('A') ? 'B' : 'A')), false);
  for (const bad of [undefined, null, '', 123, key + 'x', key.slice(1)]) {
    assert.equal(verifyOrderAccessKey('order-1', bad), false);
  }
});

test('canViewOrder: админ, владелец, ключ; чужой — нет', () => {
  const order = { id: 'order-1', userId: 'u1' };
  const key = orderAccessKey('order-1');
  assert.equal(canViewOrder(order, { id: 'adm', role: 'admin' }), true);
  assert.equal(canViewOrder(order, { id: 'u1', role: 'learner' }), true);
  assert.equal(canViewOrder(order, null, key), true);
  assert.equal(canViewOrder(order, { id: 'u2', role: 'learner' }), false);
  assert.equal(canViewOrder(order, null), false);
  assert.equal(canViewOrder({ id: 'order-1', userId: null }, { id: 'u2', role: 'learner' }), false);
  assert.equal(canViewOrder(order, { id: 'u2', role: 'author' }, 'wrong'), false);
});

test('сумма прописью: русский', () => {
  assert.equal(amountInWords(49000, 'ru'), 'Сорок девять тысяч тенге 00 тиын');
  assert.equal(amountInWords(99000, 'ru'), 'Девяносто девять тысяч тенге 00 тиын');
  assert.equal(amountInWords(21000, 'ru'), 'Двадцать одна тысяча тенге 00 тиын');
  assert.equal(amountInWords(2000, 'ru'), 'Две тысячи тенге 00 тиын');
  assert.equal(amountInWords(112, 'ru'), 'Сто двенадцать тенге 00 тиын');
  assert.equal(amountInWords(2_350_001, 'ru'), 'Два миллиона триста пятьдесят тысяч один тенге 00 тиын');
  assert.equal(numberInWords(14_000, 'ru'), 'четырнадцать тысяч');
  assert.equal(numberInWords(0, 'ru'), 'ноль');
});

test('сумма прописью: казахский', () => {
  assert.equal(amountInWords(49000, 'kz'), 'Қырық тоғыз мың теңге 00 тиын');
  assert.equal(amountInWords(99000, 'kz'), 'Тоқсан тоғыз мың теңге 00 тиын');
  assert.equal(amountInWords(101_000, 'kz'), 'Бір жүз бір мың теңге 00 тиын');
  assert.equal(numberInWords(2_350_001, 'kz'), 'екі миллион үш жүз елу мың бір');
});
