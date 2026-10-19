// Сертификаты: только после 100 %, идемпотентность, коллизия номера, публичная проверка.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { enroll, revokeEnrollment } from '../../src/lib/access';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { CERT_NUMBER_RE, findCertificateByNumber, getCertificate, issueCertificate } from '../../src/lib/learn/certificates';
import { LearnError, type LearnErrorCode } from '../../src/lib/learn/errors';
import { completeLesson } from '../../src/lib/learn/progress';

let db: TestDb;

async function refuses(code: LearnErrorCode, p: Promise<unknown>) {
  await assert.rejects(p, (e) => e instanceof LearnError && e.code === code, `ожидался отказ ${code}`);
}

async function lesson(id: string, course: string, mod: string, pos: number, status = 'published') {
  await db.sql`
    INSERT INTO lessons (id, course_id, module_id, position, slug, title, content, duration_min, status, created_at, updated_at)
    VALUES (${id}, ${course}, ${mod}, ${pos}, ${id}, ${db.json({ ru: id })},
            ${db.json({ ru: { v: 1, blocks: [{ id: 't', type: 'text', markdown: 'x' }] } })}, 5, ${status}, 1, 1)`;
}

const user = (id: string) => ({ id, name: `Имя ${id}` });

before(async () => {
  db = await createTestDb();
  for (const u of ['a', 'b', 'c', 'd']) {
    await db.sql`INSERT INTO users (id, email, name, created_at) VALUES (${u}, ${u + '@secret.kz'}, ${'Имя ' + u}, 1)`;
  }
  await db.sql`INSERT INTO courses (id, slug, title, status, created_at, updated_at)
               VALUES ('c1', 'c1', ${db.json({ ru: 'Курс 1', kz: 'Курс 1 қаз' })}, 'published', 1, 1),
                      ('empty', 'empty', ${db.json({ ru: 'Пустой' })}, 'published', 1, 1)`;
  await db.sql`INSERT INTO course_modules (id, course_id, position, title, created_at)
               VALUES ('m1', 'c1', 0, ${db.json({ ru: 'М1' })}, 1), ('me', 'empty', 0, ${db.json({ ru: 'М' })}, 1)`;
  await lesson('l1', 'c1', 'm1', 0);
  await lesson('l2', 'c1', 'm1', 1);
  await lesson('ld', 'empty', 'me', 0, 'draft'); // в «пустом» курсе нет опубликованных уроков
  for (const u of ['a', 'b', 'c', 'd']) await enroll({ userId: u, courseId: 'c1', source: 'grant' });
  await enroll({ userId: 'a', courseId: 'empty', source: 'grant' });
});
after(async () => {
  await db.close();
});

test('до 100 % сертификат не выдаётся', async () => {
  await refuses('not_complete', issueCertificate({ user: user('a'), courseId: 'c1', locale: 'ru' }));
  await completeLesson({ userId: 'a', lessonId: 'l1', locale: 'ru' });
  await refuses('not_complete', issueCertificate({ user: user('a'), courseId: 'c1', locale: 'ru' }));
  assert.equal(await getCertificate('a', 'c1'), null);
});

test('курс без опубликованных уроков 100 % не достигает', async () => {
  await refuses('not_complete', issueCertificate({ user: user('a'), courseId: 'empty', locale: 'ru' }));
});

test('на 100 % выдаётся: номер по формату, ФИО из профиля, локаль, запись в журнале', async () => {
  await completeLesson({ userId: 'a', lessonId: 'l2', locale: 'ru' });
  const { certificate, created } = await issueCertificate({ user: user('a'), courseId: 'c1', locale: 'kz' });
  assert.equal(created, true);
  assert.match(certificate.number, CERT_NUMBER_RE);
  assert.equal(certificate.holderName, 'Имя a');
  assert.equal(certificate.locale, 'kz');
  assert.equal(certificate.userId, 'a');
  assert.ok(Math.abs(certificate.issuedAt - Date.now()) < 5000);
  const log = await db.sql<{ actorId: string }>`
    SELECT actor_id FROM audit_log WHERE action = 'certificate.issue' AND entity_id = ${certificate.id}`;
  assert.equal(log.length, 1);
  assert.equal(log[0]?.actorId, 'a');
});

test('идемпотентно: повтор и параллельные вызовы дают один и тот же сертификат', async () => {
  const first = await getCertificate('a', 'c1');
  const again = await issueCertificate({ user: user('a'), courseId: 'c1', locale: 'ru' });
  assert.equal(again.created, false);
  assert.equal(again.certificate.number, first?.number);
  assert.equal(again.certificate.locale, 'kz'); // язык фиксируется при выдаче

  await completeLesson({ userId: 'b', lessonId: 'l1', locale: 'ru' });
  await completeLesson({ userId: 'b', lessonId: 'l2', locale: 'ru' });
  const all = await Promise.all(
    Array.from({ length: 6 }, () => issueCertificate({ user: user('b'), courseId: 'c1', locale: 'ru' })),
  );
  assert.equal(new Set(all.map((r) => r.certificate.number)).size, 1);
  assert.equal(all.filter((r) => r.created).length, 1);
  const rows = await db.sql`SELECT 1 FROM certificates WHERE user_id = 'b' AND course_id = 'c1'`;
  assert.equal(rows.length, 1);
});

test('коллизия номера: выдача повторяется с другим номером', async () => {
  const taken = (await getCertificate('a', 'c1'))?.number as string;
  await completeLesson({ userId: 'c', lessonId: 'l1', locale: 'ru' });
  await completeLesson({ userId: 'c', lessonId: 'l2', locale: 'ru' });
  const queue = [taken, taken, 'CRP-2026-FRESH2'];
  const { certificate } = await issueCertificate({
    user: user('c'),
    courseId: 'c1',
    locale: 'ru',
    generateNumber: () => queue.shift() as string,
  });
  assert.equal(certificate.number, 'CRP-2026-FRESH2');
  assert.equal(queue.length, 0);
  const rows = await db.sql`SELECT 1 FROM certificates WHERE number = ${taken}`;
  assert.equal(rows.length, 1); // чужой номер не тронут
});

test('новый сертификат требует действующего доступа; выданный остаётся при отзыве доступа', async () => {
  await completeLesson({ userId: 'd', lessonId: 'l1', locale: 'ru' });
  await completeLesson({ userId: 'd', lessonId: 'l2', locale: 'ru' });
  await revokeEnrollment('d', 'c1', null);
  await refuses('forbidden', issueCertificate({ user: user('d'), courseId: 'c1', locale: 'ru' }));
  await refuses('not_found', issueCertificate({ user: user('d'), courseId: 'нет-курса', locale: 'ru' }));

  await enroll({ userId: 'd', courseId: 'c1', source: 'grant' });
  const { certificate } = await issueCertificate({ user: user('d'), courseId: 'c1', locale: 'ru' });
  await revokeEnrollment('d', 'c1', null);
  const kept = await issueCertificate({ user: user('d'), courseId: 'c1', locale: 'ru' });
  assert.equal(kept.certificate.number, certificate.number);
  assert.equal(kept.created, false);
});

test('публичная проверка: ФИО, курс, дата — и ничего лишнего', async () => {
  const cert = (await getCertificate('a', 'c1')) as NonNullable<Awaited<ReturnType<typeof getCertificate>>>;
  const found = await findCertificateByNumber(cert.number.toLowerCase());
  assert.ok(found);
  assert.equal(found.holderName, 'Имя a');
  assert.deepEqual(found.courseTitle, { ru: 'Курс 1', kz: 'Курс 1 қаз' });
  assert.equal(found.issuedAt, cert.issuedAt);
  assert.deepEqual(Object.keys(found).sort(), ['courseTitle', 'holderName', 'issuedAt', 'locale', 'number']);
  assert.equal(JSON.stringify(found).includes('secret.kz'), false); // email не просачивается
});

test('публичная проверка: неизвестный номер и мусор — null', async () => {
  assert.equal(await findCertificateByNumber('CRP-2026-ZZZZZZ'), null);
  assert.equal(await findCertificateByNumber('nonsense'), null);
  assert.equal(await findCertificateByNumber("' OR 1=1 --"), null);
  assert.equal(await findCertificateByNumber(null), null);
});
