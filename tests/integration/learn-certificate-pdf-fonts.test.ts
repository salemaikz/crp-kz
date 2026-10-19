// Состояние шрифтов react-pdf между документами. Отдельный файл: тест исполняется в своём процессе,
// и ему нужны именно первые рендеры процесса (после других документов дефект не воспроизводится).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { loadCertificatePdfInput } from '../../src/lib/learn/pdf/data';
import { renderCertificatePdf } from '../../src/lib/learn/pdf/render';
import { missingChars, unicodeInPdf } from '../helpers/pdf-text';
import { PDF_COURSE_SLUG, seedPdf } from './fixtures/learn-certificate-pdf.seed';

let db: TestDb;
before(async () => {
  db = await createTestDb();
  await seedPdf(db);
});
after(async () => {
  await db.close();
});

const LONG_NAME = 'Әлия Құрманғалиқызы Нұрсұлтанова-Ахметжанова Қызыл Жұлдыз Ғабиден';
const LONG_COURSE =
  'Операциялық менеджмент және стратегиялық жоспарлау негіздері: кәсіпкерлерге арналған кеңейтілген бағдарлама, ұзақ атаумен және бірнеше жолмен';

test('второй рендер в процессе не теряет символы, которых не было в первом', async () => {
  // регрессия: без сброса шрифтов react-pdf во втором документе пропадала «г» из названия курса.
  // В подписях и дате kz-сертификата строчной «г» нет (заглавные подписи, «ж.»), поэтому она
  // может попасть в PDF только из названия курса.
  const base = (await loadCertificatePdfInput('pdf-owner', PDF_COURSE_SLUG))!;
  const first = await renderCertificatePdf({ ...base, courseTitle: 'Бизнесті талдау қалай өтеді: ғылыми-практикалық курс' });
  assert.ok(!unicodeInPdf(first).has(0x433), 'в первом PDF «г» быть не должно');
  const second = await renderCertificatePdf({ ...base, holderName: LONG_NAME, courseTitle: LONG_COURSE });
  assert.deepEqual(missingChars(second, LONG_NAME, LONG_COURSE), [], 'во втором PDF потеряны символы');
  assert.ok(unicodeInPdf(second).has(0x433));
});

test('параллельные рендеры идут по очереди, каждый PDF целый', async () => {
  const base = (await loadCertificatePdfInput('pdf-ru', PDF_COURSE_SLUG))!;
  const titles = ['Первый курс', 'Второй гүл қызыл', 'Третий қала ғылым', 'Четвёртый: ұйым және өнер'];
  const all = await Promise.all(titles.map((t) => renderCertificatePdf({ ...base, courseTitle: t })));
  all.forEach((pdf, i) => {
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-');
    assert.deepEqual(missingChars(pdf, base.holderName, titles[i]!), [], `PDF ${i + 1}`);
  });
});
