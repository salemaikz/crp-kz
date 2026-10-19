// «Моё обучение» на демо-данных сида: прогресс, сроки, замки, сертификаты, закрытый доступ.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { enroll, revokeEnrollment } from '../../src/lib/access';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { seed } from '../../src/lib/db/seed';
import { seedUserId } from '../../src/lib/db/seed/people';
import { listCertificates, listLearnerCourses } from '../../src/lib/learn/data';
import { loadCourseAccess } from '../../src/lib/learn/gate';
import { completeLesson } from '../../src/lib/learn/progress';
import { submitQuiz } from '../../src/lib/learn/quiz';
import { issueCertificate } from '../../src/lib/learn/certificates';

let db: TestDb;
const client = seedUserId('client@crp.demo');
const operator = seedUserId('operator@crp.demo');
const admin = seedUserId('admin@crp.demo');

before(async () => {
  db = await createTestDb();
  await seed(db);
});
after(async () => {
  await db.close();
});

test('клиент демо: «Целина» частично пройдена, «Как проходит бизнес-разбор» пройден с сертификатом', async () => {
  const list = await listLearnerCourses(client);
  const bySlug = new Map(list.map((l) => [l.course.slug, l]));
  assert.deepEqual([...bySlug.keys()].sort(), ['celina', 'razbor']);

  const celina = bySlug.get('celina');
  assert.ok(celina);
  assert.equal(celina.access.ok, true);
  assert.equal(celina.enrollment.source, 'purchase');
  assert.ok(celina.progress.total >= 16);
  assert.ok(celina.progress.done > 0 && celina.progress.done < celina.progress.total);
  assert.equal(celina.progress.complete, false);
  assert.equal(celina.progress.next?.state, 'open');
  assert.equal(celina.certificateNumber, null);

  const razbor = bySlug.get('razbor');
  assert.ok(razbor);
  assert.deepEqual([razbor.progress.pct, razbor.progress.complete, razbor.progress.next], [100, true, null]);
  assert.match(razbor.certificateNumber ?? '', /^CRP-\d{4}-[A-Z2-9]{6}$/);

  const certs = await listCertificates(client);
  assert.equal(certs.length, 1);
  assert.equal(certs[0]?.courseSlug, 'razbor');
  assert.equal(certs[0]?.courseStatus, 'published');
  assert.equal(certs[0]?.number, razbor.certificateNumber);
});

test('оператор: внутренний курс последовательный, срок назначения виден, часть уроков закрыта замком', async () => {
  const [item] = await listLearnerCourses(operator);
  assert.ok(item);
  assert.equal(item.course.sequential, true);
  assert.equal(item.enrollment.source, 'assignment');
  assert.ok(item.enrollment.dueAt && item.enrollment.dueAt > Date.now());

  const access = await loadCourseAccess(operator, { slug: item.course.slug });
  assert.ok(access.status === 'ok');
  const states = access.progress.lessons.map((l) => l.state);
  const firstOpen = states.indexOf('open');
  assert.ok(firstOpen > 0, 'часть уроков уже пройдена');
  assert.ok(states.slice(0, firstOpen).every((s) => s === 'done'));
  assert.ok(states.slice(firstOpen + 1).every((s) => s === 'locked'));
  assert.equal(access.progress.next?.id, access.progress.lessons[firstOpen]?.id);

  // закрытый урок сервер не принимает
  const locked = access.progress.lessons.find((l) => l.state === 'locked');
  assert.ok(locked);
  await assert.rejects(completeLesson({ userId: operator, lessonId: locked.id, locale: 'ru' }), /locked/);
});

test('операторский курс: чужой для клиента internal-курс не раскрывается', async () => {
  const [item] = await listLearnerCourses(operator);
  assert.ok(item);
  assert.equal((await loadCourseAccess(client, { slug: item.course.slug })).status, 'not_found');
});

test('отозванное зачисление остаётся в списке с прогрессом и состоянием «закрыто»', async () => {
  await revokeEnrollment(client, (await listLearnerCourses(client)).find((l) => l.course.slug === 'celina')?.course.id as string, admin);
  const celina = (await listLearnerCourses(client)).find((l) => l.course.slug === 'celina');
  assert.ok(celina);
  assert.equal(celina.access.ok, false);
  assert.equal(celina.access.reason, 'revoked');
  assert.ok(celina.progress.done > 0);
  const a = await loadCourseAccess(client, { slug: 'celina' });
  assert.ok(a.status === 'denied' && a.reason === 'revoked');
});

test('сквозной сценарий на «Целине»: пройти оставшееся с тестами и получить сертификат', async () => {
  const course = (await listLearnerCourses(client)).find((l) => l.course.slug === 'celina');
  assert.ok(course);
  await enroll({ userId: client, courseId: course.course.id, source: 'grant', grantedBy: admin });

  const access = await loadCourseAccess(client, { slug: 'celina' });
  assert.ok(access.status === 'ok');
  assert.equal((await issueCertificate({ user: { id: client, name: 'Марат Нурланов' }, courseId: access.course.id, locale: 'ru' }).catch((e: Error) => e.message)), 'not_complete');

  for (const l of access.progress.lessons.filter((x) => x.state !== 'done')) {
    const [row] = await db.sql<{ content: { ru: { blocks: Array<{ id: string; type: string; questions?: Array<{ correct: number[]; multiple: boolean; options: string[] }> }> } } }>`
      SELECT content FROM lessons WHERE id = ${l.id}`;
    for (const b of row?.content.ru.blocks ?? []) {
      if (b.type !== 'quiz') continue;
      const answers = (b.questions ?? []).map((q) => q.correct);
      const r = await submitQuiz({ userId: client, lessonId: l.id, blockId: b.id, answers, locale: 'ru' });
      assert.equal(r.passed, true);
    }
    await completeLesson({ userId: client, lessonId: l.id, locale: 'ru' });
  }
  const done = await loadCourseAccess(client, { slug: 'celina' });
  assert.ok(done.status === 'ok' && done.progress.complete && done.progress.pct === 100);

  const { certificate, created } = await issueCertificate({
    user: { id: client, name: 'Марат Нурланов' },
    courseId: done.course.id,
    locale: 'ru',
  });
  assert.equal(created, true);
  assert.equal(certificate.holderName, 'Марат Нурланов');
  assert.equal((await listCertificates(client)).length, 2);
});
