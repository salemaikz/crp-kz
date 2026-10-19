// Письма: все семь шаблонов на ru и kz, ссылки, экранирование, плюрализация, стиль без «→» и «!».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Locale } from '../../src/lib/content/types';
import { mailLink } from '../../src/lib/mail/links';
import type { MailRow } from '../../src/lib/mail/outbox';
import { renderMail } from '../../src/lib/mail/render';
import { MAIL_TEMPLATES, type MailTemplate } from '../../src/lib/mail/types';

const SITE = 'https://learn.example.kz';
const TOKEN = 'A'.repeat(43);
// 19 октября 2026, 11:00 по Астане
const CREATED = Date.UTC(2026, 9, 19, 6, 0);
const DAY = 86_400_000;
let savedSite: string | undefined;

before(() => {
  savedSite = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});
after(() => {
  if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
});

const title = { ru: 'Основы продаж', kz: 'Сату негіздері' };

function paramsFor(template: MailTemplate, name = 'Айгерим'): Record<string, unknown> {
  switch (template) {
    case 'password_reset':
      return { name };
    case 'password_changed':
      return { name, changedAt: CREATED };
    case 'email_verify':
      return { name, next: '/ru/courses/sales/buy' };
    case 'assignment_new':
      return { name, courseSlug: 'sales', courseTitle: title, dueAt: CREATED + 6 * DAY };
    case 'due_soon':
      return { name, courseSlug: 'sales', courseTitle: title, dueAt: CREATED + 2 * DAY, progress: 40 };
    case 'overdue':
      return { name, courseSlug: 'sales', courseTitle: title, dueAt: CREATED - 3 * DAY, progress: 10 };
    case 'manager_digest':
      return {
        name,
        orgName: 'ЦРП',
        orgSlug: 'crp',
        overdue: [{ name: 'Марат', courseTitle: title, dueAt: CREATED - DAY }],
        soon: [{ name: 'Дана', courseTitle: title, dueAt: CREATED + 2 * DAY }],
        overdueTotal: 25,
        soonTotal: 1,
      };
  }
}

function row(template: MailTemplate, locale: Locale, over: Partial<MailRow> = {}): MailRow {
  const withSecret = template === 'password_reset' || template === 'email_verify';
  return {
    id: 'm1',
    template,
    locale,
    toEmail: 'user@example.kz',
    params: paramsFor(template),
    secret: withSecret ? TOKEN : null,
    secretExpiresAt: withSecret ? CREATED + 3_600_000 : null,
    status: 'held',
    createdAt: CREATED,
    ...over,
  };
}

/** HTML без служебной строки doctype: её «!» не видна читателю. */
const visibleHtml = (html: string) => html.replace('<!DOCTYPE html>', '');

for (const template of MAIL_TEMPLATES) {
  test(`${template}: ru и kz собираются, тексты различаются, нет «→» и «!»`, () => {
    const ru = renderMail(row(template, 'ru'));
    const kz = renderMail(row(template, 'kz'));
    for (const m of [ru, kz]) {
      assert.ok(m.subject.length > 0);
      assert.ok(m.text.length > 0);
      assert.ok(m.html.includes('<html'));
      assert.doesNotMatch(m.subject, /[\r\n]/);
      for (const part of [m.subject, m.text, visibleHtml(m.html)]) {
        assert.doesNotMatch(part, /→|!/, template);
      }
    }
    assert.notEqual(ru.subject, kz.subject);
    assert.notEqual(ru.text, kz.text);
    assert.match(ru.html, /<html lang="ru"/);
    assert.match(kz.html, /<html lang="kk"/);
  });

  test(`${template}: ссылка абсолютная и от siteUrl()`, () => {
    const link = mailLink(row(template, 'ru'));
    assert.ok(link, template);
    assert.ok(link.startsWith(`${SITE}/ru/`), link);
    const kzLink = mailLink(row(template, 'kz'));
    assert.ok(kzLink?.startsWith(`${SITE}/kz/`), String(kzLink));
    const m = renderMail(row(template, 'ru'));
    assert.ok(m.text.includes(link));
    assert.ok(m.html.includes(`href="${link.replace(/&/g, "&amp;")}"`));
  });
}

test('ссылки: токен после #, next проходит через safeNext', () => {
  assert.equal(mailLink(row('password_reset', 'ru')), `${SITE}/ru/password/reset#token=${TOKEN}`);
  assert.equal(
    mailLink(row('email_verify', 'kz')),
    `${SITE}/kz/account/verify#token=${TOKEN}&next=${encodeURIComponent('/ru/courses/sales/buy')}`,
  );
  const evil = mailLink(row('email_verify', 'ru', { params: { name: 'A', next: 'https://evil.example' } }));
  assert.equal(evil, `${SITE}/ru/account/verify#token=${TOKEN}`);
  assert.equal(mailLink(row('password_changed', 'ru')), `${SITE}/ru/password/forgot`);
  assert.equal(mailLink(row('overdue', 'ru')), `${SITE}/ru/learn/sales`);
  assert.equal(mailLink(row('manager_digest', 'ru')), `${SITE}/ru/team?org=crp&status=overdue`);
});

test('без секрета письмо со ссылкой доступа остаётся без ссылки', () => {
  const r = row('password_reset', 'ru', { secret: null, secretExpiresAt: null });
  assert.equal(mailLink(r), null);
  const m = renderMail(r);
  assert.ok(!m.text.includes('http'));
  assert.ok(!m.html.includes('href='));
});

test('hideSecretLink: токена нет нигде, остальные ссылки на месте', () => {
  const m = renderMail(row('password_reset', 'ru'), { hideSecretLink: true });
  for (const part of [m.subject, m.text, m.html]) assert.ok(!part.includes(TOKEN));
  assert.ok(m.text.includes('Задать новый пароль'));
  const digest = renderMail(row('manager_digest', 'ru'), { hideSecretLink: true });
  assert.ok(digest.text.includes(`${SITE}/ru/team`));
});

test('имя с разметкой экранируется, переводы строк не попадают в тему', () => {
  const m = renderMail(row('password_reset', 'ru', { params: { name: '<script>x</script>' } }));
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;x&lt;/script&gt;'));

  const inj = renderMail(
    row('assignment_new', 'ru', {
      params: { ...paramsFor('assignment_new', 'Имя\r\nBcc: evil@example.kz'), courseTitle: { ru: 'Курс\r\nBcc: evil@example.kz' } },
    }),
  );
  assert.doesNotMatch(inj.subject, /[\r\n]/);
  assert.match(inj.subject, /Курс Bcc: evil@example.kz/);
  assert.doesNotMatch(inj.text.split('\n\n')[0] ?? '', /\r|\n/);
});

test('кавычка в значении не выходит из атрибута', () => {
  const m = renderMail(row('manager_digest', 'ru', { params: { ...paramsFor('manager_digest'), orgSlug: 'a"><b' } }));
  assert.ok(!m.html.includes('"><b'));
});

test('due_soon: плюрализация 0, 1, 2, 5 дней', () => {
  const body = (days: number, locale: Locale) =>
    renderMail(row('due_soon', locale, { params: { ...paramsFor('due_soon'), dueAt: CREATED + days * DAY } })).text;
  assert.match(body(0, 'ru'), /Срок — сегодня\./);
  assert.match(body(1, 'ru'), /остался 1 день\./);
  assert.match(body(2, 'ru'), /осталось 2 дня\./);
  assert.match(body(5, 'ru'), /осталось 5 дней\./);
  assert.match(body(0, 'kz'), /Мерзім — бүгін\./);
  assert.match(body(3, 'kz'), /Мерзімге дейін 3 күн қалды\./);
});

test('даты: ru по-русски, kz по-казахски (Intl kk)', () => {
  const ru = renderMail(row('assignment_new', 'ru')).text;
  const kz = renderMail(row('assignment_new', 'kz')).text;
  assert.match(ru, /25 октября/);
  assert.match(kz, /25 қазан/);
});

test('сводка руководителю: строки, остаток и пустые списки', () => {
  const m = renderMail(row('manager_digest', 'ru'));
  assert.match(m.text, /Просрочено: 25\. Срок в ближайшие 3 дня: 1\./);
  assert.match(m.text, /- Марат — Основы продаж — 18 октября/);
  assert.match(m.text, /И ещё 24 в отчёте\./);
  const empty = renderMail(row('manager_digest', 'ru', { params: { ...paramsFor('manager_digest'), overdue: [], soon: [], overdueTotal: 0, soonTotal: 0 } }));
  assert.doesNotMatch(empty.text, /Просрочено\n/);
});

test('тексты писем в mail.json: нет «→» и «!»', () => {
  for (const locale of ['ru', 'kz']) {
    const json = readFileSync(join(import.meta.dirname, '..', '..', 'messages', locale, 'mail.json'), 'utf8');
    assert.doesNotMatch(json, /→|!/, locale);
  }
});
