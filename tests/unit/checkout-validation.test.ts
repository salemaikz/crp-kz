import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidBin, normalizePhone, parseCheckout } from '../../src/lib/orders/validation';

const VALID_BIN = '980101400008';

const person = {
  courseSlug: 'sales-doubling',
  buyerType: 'person',
  name: '  Сауле Омарова ',
  email: ' Saule@Example.KZ ',
  phone: '8 (701) 100-09-29',
  paymentMethod: 'kaspi',
  consent: 'on',
};

test('телефон РК нормализуется в +7 7XX XXX XX XX', () => {
  for (const raw of ['+7 701 100 09 29', '8 (701) 100-09-29', '87011000929', '7011000929', '+7(701)1000929']) {
    assert.equal(normalizePhone(raw), '+7 701 100 09 29', raw);
  }
  assert.equal(normalizePhone('+7 7172 55 66 77'), '+7 717 255 66 77'); // городской Астаны
});

test('чужие и битые телефоны отклоняются', () => {
  for (const raw of [
    '',
    '12345',
    '+7 912 100 09 29',
    '+8 701 100 09 29',
    '+1 701 100 09 29',
    '701-100-09',
    'phone 87011000929',
    '8701100092900',
  ]) {
    assert.equal(normalizePhone(raw), null, raw);
  }
});

test('БИН: 12 цифр и контрольная цифра', () => {
  assert.equal(isValidBin('141240000394'), true); // БИН ЦРП (публичный)
  assert.equal(isValidBin(VALID_BIN), true);
  assert.equal(isValidBin('123456789012'), false); // неверная контрольная
  assert.equal(isValidBin('14124000039'), false);
  assert.equal(isValidBin('14124000039a'), false);
});

test('физлицо: данные нормализованы, поля компании игнорируются', () => {
  const r = parseCheckout({ ...person, companyName: 'ТОО', companyBin: '1' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.data, {
    courseSlug: 'sales-doubling',
    buyerType: 'person',
    name: 'Сауле Омарова',
    email: 'saule@example.kz',
    phone: '+7 701 100 09 29',
    companyName: null,
    companyBin: null,
    paymentMethod: 'kaspi',
  });
});

test('ошибки по полям: обязательные, формат, согласие', () => {
  const r = parseCheckout({ courseSlug: 'x', buyerType: 'person', paymentMethod: 'kaspi' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.errors, { name: 'required', email: 'required', phone: 'required', consent: 'required' });

  const bad = parseCheckout({ ...person, name: 'А', email: 'not-an-email', phone: '+7 912 000 00 00' });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.equal(bad.errors.name, 'too_short');
  assert.equal(bad.errors.email, 'invalid');
  assert.equal(bad.errors.phone, 'invalid');
  // значения возвращаются в форму как ввёл человек
  assert.equal(bad.values.email, 'not-an-email');
  assert.equal(bad.values.consent, true);
});

test('юрлицо: название, БИН с контрольной цифрой и только счёт', () => {
  const company = { ...person, buyerType: 'company', paymentMethod: 'invoice', companyName: 'ТОО «Дала»' };
  const missing = parseCheckout(company);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors.companyBin, 'required');

  const format = parseCheckout({ ...company, companyBin: '12345' });
  if (!format.ok) assert.equal(format.errors.companyBin, 'format');
  const checksum = parseCheckout({ ...company, companyBin: '123456789012' });
  if (!checksum.ok) assert.equal(checksum.errors.companyBin, 'checksum');

  const kaspi = parseCheckout({ ...company, companyBin: VALID_BIN, paymentMethod: 'kaspi' });
  assert.equal(kaspi.ok, false);
  if (!kaspi.ok) assert.equal(kaspi.errors.paymentMethod, 'company_invoice_only');

  const ok = parseCheckout({ ...company, companyBin: '9801 0140 0008' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.data.companyBin, VALID_BIN);
    assert.equal(ok.data.companyName, 'ТОО «Дала»');
    assert.equal(ok.data.paymentMethod, 'invoice');
  }
});

test('физлицо может выбрать оплату по счёту; неизвестные значения отклоняются', () => {
  assert.equal(parseCheckout({ ...person, paymentMethod: 'invoice' }).ok, true);
  const r = parseCheckout({ ...person, paymentMethod: 'cash', buyerType: 'robot', courseSlug: '../etc' });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.errors.paymentMethod, 'invalid');
    assert.equal(r.errors.buyerType, 'invalid');
    assert.equal(r.errors.courseSlug, 'invalid');
  }
});

test('сумма и цена из формы не принимаются', () => {
  const r = parseCheckout({ ...person, amountKzt: '1', priceKzt: '1' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal('amountKzt' in r.data || 'priceKzt' in r.data, false);
});
