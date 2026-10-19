// PDF сертификата: данные для файла, рендер на ru и kz, отсутствие email в байтах, маршрут (отдельный процесс).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { loadCertificatePdfInput } from '../../src/lib/learn/pdf/data';
import { renderCertificatePdf } from '../../src/lib/learn/pdf/render';
import { pdfText, unicodeInPdf } from '../helpers/pdf-text';
import { OWNER_EMAIL, OWNER_NAME, PDF_COURSE_SLUG, PDF_NUMBER, RU_NUMBER, seedPdf } from './fixtures/learn-certificate-pdf.seed';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: TestDb;

before(async () => {
  db = await createTestDb();
  await seedPdf(db);
});
after(async () => {
  await db.close();
});

test('владелец получает данные; доступ закрыт — сертификат всё равно доступен', async () => {
  const input = await loadCertificatePdfInput('pdf-owner', PDF_COURSE_SLUG);
  assert.ok(input);
  assert.equal(input.number, PDF_NUMBER);
  assert.equal(input.holderName, OWNER_NAME);
  assert.equal(input.locale, 'kz');
  assert.equal(input.courseTitle, 'Бизнесті талдау: ғылыми-практикалық үлгі');
  assert.match(input.verifyUrl, new RegExp(`/kz/cert/${PDF_NUMBER}$`));
  assert.equal(input.labels.metaTitle, `Сертификат ${PDF_NUMBER}`);
  assert.equal(input.verifyHost, `${new URL(input.verifyUrl).host}/kz/cert`);
});

test('в данных для файла нет email и id пользователя', async () => {
  const input = await loadCertificatePdfInput('pdf-owner', PDF_COURSE_SLUG);
  const json = JSON.stringify(input);
  assert.ok(!json.includes(OWNER_EMAIL) && !json.includes('@'), 'email в данных PDF');
  assert.ok(!json.includes('pdf-owner'), 'id пользователя в данных PDF');
});

test('чужой сертификат, нет сертификата, курс в черновике, нет курса — null', async () => {
  assert.equal(await loadCertificatePdfInput('pdf-other', PDF_COURSE_SLUG), null);
  assert.equal(await loadCertificatePdfInput('pdf-owner', 'pdf-draft'), null);
  assert.equal(await loadCertificatePdfInput('pdf-owner', 'net-takogo'), null);
  assert.equal(await loadCertificatePdfInput('net-takogo', PDF_COURSE_SLUG), null);
});

test('рендер kz: валидный PDF, одна страница A4 альбомная, шрифты Geologica и Onest, без email', async () => {
  const input = (await loadCertificatePdfInput('pdf-owner', PDF_COURSE_SLUG))!;
  const pdf = await renderCertificatePdf(input);
  const head = Buffer.from(pdf.subarray(0, 5)).toString('latin1');
  const tail = Buffer.from(pdf.subarray(Math.max(0, pdf.length - 16))).toString('latin1');
  assert.equal(head, '%PDF-');
  assert.match(tail, /%%EOF\s*$/);
  assert.ok(pdf.byteLength < 400 * 1024, `размер ${pdf.byteLength}`);

  const text = pdfText(pdf);
  assert.match(text, /\/Count 1\b/);
  assert.match(text, /\/Lang \(kk\)/);
  assert.match(text, /\/MediaBox \[0 0 841\.89\d* 595\.28\d*\]/);
  assert.match(text, /\/BaseFont \/[A-Z]+\+Geologica/);
  assert.match(text, /\/BaseFont \/[A-Z]+\+Onest/);
  assert.ok(!text.includes(OWNER_EMAIL) && !text.includes('secret.invalid') && !text.includes('crp-pdf.invalid'), 'email в байтах');

  // казахские буквы ФИО и курса ушли в текст документа, а «@» — нет
  const chars = unicodeInPdf(pdf);
  for (const ch of 'ӘҚұғқү') assert.ok(chars.has(ch.codePointAt(0)!), `нет «${ch}»`);
  assert.ok(!chars.has(0x40), 'в тексте PDF есть «@»');
});

test('рендер ru: язык сертификата — ru, QR ведёт на /ru/cert/…', async () => {
  const input = (await loadCertificatePdfInput('pdf-ru', PDF_COURSE_SLUG))!;
  assert.equal(input.locale, 'ru');
  assert.equal(input.courseTitle, 'Бизнес-разбор');
  assert.match(input.verifyUrl, new RegExp(`/ru/cert/${RU_NUMBER}$`));
  const pdf = await renderCertificatePdf(input);
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-');
  assert.match(pdfText(pdf), /\/Lang \(ru\)/);
});

test('маршрут: флаг, гость, лимит, 404, ETag и 304 без рендера (отдельный процесс)', () => {
  const env = { ...process.env };
  for (const k of ['DATABASE_URL', 'SESSION_SECRET', 'TEST_DATABASE_URL', 'DEMO_MODE', 'FEATURE_CERT_PDF', 'NEXT_PUBLIC_SITE_URL']) delete env[k];
  delete env.NODE_TEST_CONTEXT; // иначе дочерний node --test отдаёт отчёт родителю, а не в stdout
  const res = spawnSync(
    process.execPath,
    ['--experimental-test-module-mocks', '--no-warnings', '--import', 'tsx', '--test', path.join(here, 'fixtures/learn-certificate-pdf.flow.ts')],
    { env, encoding: 'utf8', timeout: 120_000 },
  );
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /# pass 8/);
});
