// Конфиг почты: транспорт и значения по умолчанию (D-030).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAIL_AUTH_RECIPIENT_HOURLY,
  mailAuthHourlyCap,
  mailFrom,
  mailReplyTo,
  mailRetentionDays,
  mailTransportName,
} from '../../src/lib/mail/config';
import { MAIL_CATEGORY, MAIL_TEMPLATES } from '../../src/lib/mail/types';

const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x@h/db' };

test('транспорт: в демо всегда outbox, вне демо пока тоже только outbox', () => {
  assert.equal(mailTransportName({ NODE_ENV: 'development' }), 'outbox');
  assert.equal(mailTransportName({ NODE_ENV: 'development', MAIL_TRANSPORT: 'smtp' }), 'outbox', 'демо не отправляет наружу');
  assert.equal(mailTransportName({ ...prod }), 'outbox');
  assert.equal(mailTransportName({ ...prod, MAIL_TRANSPORT: 'outbox' }), 'outbox');
});

test('транспорт: неподдерживаемое значение даёт outbox и одно предупреждение', () => {
  const warn = console.warn;
  const calls: unknown[] = [];
  console.warn = (...a: unknown[]) => void calls.push(a);
  try {
    assert.equal(mailTransportName({ ...prod, MAIL_TRANSPORT: 'smtp' }), 'outbox');
    assert.equal(mailTransportName({ ...prod, MAIL_TRANSPORT: 'smtp' }), 'outbox');
    assert.equal(calls.length, 1);
  } finally {
    console.warn = warn;
  }
});

test('отправитель и адрес для ответов: пустые строки — null', () => {
  assert.equal(mailFrom({}), null);
  assert.equal(mailFrom({ MAIL_FROM: '  ' }), null);
  assert.equal(mailFrom({ MAIL_FROM: ' noreply@crp.kz ' }), 'noreply@crp.kz');
  assert.equal(mailReplyTo({ MAIL_REPLY_TO: 'office@crp.kz' }), 'office@crp.kz');
});

test('предохранитель и срок хранения: значения по умолчанию и разбор', () => {
  assert.equal(MAIL_AUTH_RECIPIENT_HOURLY, 5);
  assert.equal(mailAuthHourlyCap({}), 300);
  assert.equal(mailAuthHourlyCap({ MAIL_AUTH_HOURLY_CAP: '50' }), 50);
  for (const bad of ['', 'abc', '0', '-5', '1.5', '1e3']) {
    assert.equal(mailAuthHourlyCap({ MAIL_AUTH_HOURLY_CAP: bad }), 300, bad);
    assert.equal(mailRetentionDays({ MAIL_RETENTION_DAYS: bad }), 90, bad);
  }
  assert.equal(mailRetentionDays({}), 90);
  assert.equal(mailRetentionDays({ MAIL_RETENTION_DAYS: '30' }), 30);
});

test('категории: первые три шаблона — auth, остальные — notice', () => {
  assert.deepEqual(
    MAIL_TEMPLATES.filter((t) => MAIL_CATEGORY[t] === 'auth'),
    ['password_reset', 'password_changed', 'email_verify'],
  );
  assert.equal(Object.keys(MAIL_CATEGORY).length, MAIL_TEMPLATES.length);
});
