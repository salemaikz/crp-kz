// canReadFile: матрица доступа вне демо и правило публичного демо (файлы видит только админ).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { enroll, revokeEnrollment } from '../../src/lib/access';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { setCourseCover } from '../../src/lib/files/admin';
import { canReadFile, type FileReadDecision } from '../../src/lib/files/access';
import type { FileRow } from '../../src/lib/files/types';
import {
  NON_DEMO,
  admin,
  makeCourse,
  makeStorageDir,
  pdf,
  png,
  publishLessons,
  seedUsers,
  setEnv,
  upload,
  type TestCourse,
} from '../helpers/fileFixtures';

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;

const U = {
  admin,
  lrn: { id: 'lrn', role: 'learner' },
  oth: { id: 'oth', role: 'learner' },
  exp: { id: 'exp', role: 'learner' },
  rev: { id: 'rev', role: 'learner' },
  member: { id: 'mem', role: 'learner' },
  demoted: { id: 'dem', role: 'admin' }, // в БД — learner
};

let pub: TestCourse;
let seq: TestCourse;
let draft: TestCourse;
const F: Record<string, string> = {};

async function link(fileId: string, lessonId: string): Promise<void> {
  await db.sql`INSERT INTO lesson_files (lesson_id, file_id) VALUES (${lessonId}, ${fileId})`;
}

async function material(course: TestCourse, lessonId: string): Promise<string> {
  const f = await upload(pdf(`m${Math.random()}`), { purpose: 'lesson_material', courseId: course.courseId, lessonId });
  return f.id;
}

async function cover(course: TestCourse): Promise<string> {
  const f = await upload(png(1200, 675), { purpose: 'course_cover', courseId: course.courseId });
  await setCourseCover(admin, course.courseId, f.id);
  return f.id;
}

async function can(user: { id: string; role: string } | null, fileId: string): Promise<FileReadDecision> {
  const [file] = await db.sql<FileRow>`SELECT * FROM files WHERE id = ${fileId}`;
  assert.ok(file, 'файл есть в БД');
  return canReadFile(user, file);
}

before(async () => {
  storage = await makeStorageDir();
  restore = setEnv({ ...NON_DEMO, STORAGE_DIR: storage.dir });
  db = await createTestDb();
  await seedUsers(db);
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('exp', 'exp@x.kz', 'Истёк', 'learner', 1), ('rev', 'rev@x.kz', 'Отозван', 'learner', 1), ('mem', 'mem@x.kz', 'Сотрудник', 'learner', 1)`;

  pub = await makeCourse(db, { lessons: 2, status: 'published' });
  await publishLessons(db, [pub.lessonIds[0] as string]); // второй урок остаётся черновиком
  F.pubOpen = await material(pub, pub.lessonIds[0] as string);
  F.pubDraftLesson = await material(pub, pub.lessonIds[1] as string);
  F.unused = await material(pub, pub.lessonIds[0] as string);
  await link(F.pubOpen as string, pub.lessonIds[0] as string);
  await link(F.pubDraftLesson as string, pub.lessonIds[1] as string);

  seq = await makeCourse(db, { lessons: 2, status: 'published', sequential: true });
  await publishLessons(db, seq.lessonIds);
  F.seqSecond = await material(seq, seq.lessonIds[1] as string);
  await link(F.seqSecond as string, seq.lessonIds[1] as string);

  draft = await makeCourse(db, { status: 'draft' });
  await publishLessons(db, draft.lessonIds);
  F.draftCourse = await material(draft, draft.lessonIds[0] as string);
  await link(F.draftCourse as string, draft.lessonIds[0] as string);

  for (const c of [pub, seq]) {
    await enroll({ userId: 'lrn', courseId: c.courseId, source: 'grant' });
  }
  await enroll({ userId: 'exp', courseId: pub.courseId, source: 'grant' });
  await db.sql`UPDATE enrollments SET expires_at = 1 WHERE user_id = 'exp'`;
  await enroll({ userId: 'rev', courseId: pub.courseId, source: 'grant' });
  await revokeEnrollment('rev', pub.courseId, 'adm');

  // обложки
  F.coverPublic = await cover(pub);
  const coverDraft = await makeCourse(db, { status: 'draft' });
  F.coverDraft = await cover(coverDraft);

  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES ('org1', 'o1', 'Орг', 'owner', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES ('org1', 'mem', 'member', 1)`;
  const internal = await makeCourse(db, { status: 'published', visibility: 'internal' });
  await db.sql`UPDATE courses SET owner_org_id = 'org1' WHERE id = ${internal.courseId}`;
  F.coverInternal = await cover(internal);
  const priv = await makeCourse(db, { status: 'published', visibility: 'private' });
  F.coverPrivate = await cover(priv);
  await enroll({ userId: 'lrn', courseId: priv.courseId, source: 'grant' });
});
after(async () => {
  restore();
  await db.close();
  await storage.cleanup();
});

const yes = (d: FileReadDecision) => d.ok;

test('админ: черновик курса и черновик урока — да, всегда private', async () => {
  for (const id of [F.draftCourse, F.pubDraftLesson, F.unused, F.coverDraft]) {
    assert.deepEqual(await can(U.admin, id as string), { ok: true, cache: 'private' });
  }
});

test('зачисленный: опубликованный урок — да, private', async () => {
  assert.deepEqual(await can(U.lrn, F.pubOpen as string), { ok: true, cache: 'private' });
});

test('не зачисленный, истёкший, отозванный, гость — нет', async () => {
  for (const u of [U.oth, U.exp, U.rev, null]) assert.equal(yes(await can(u, F.pubOpen as string)), false, JSON.stringify(u));
});

test('файл только в черновике урока, файл без ссылок, файл черновика курса — нет', async () => {
  for (const id of [F.pubDraftLesson, F.unused, F.draftCourse]) assert.equal(yes(await can(U.lrn, id as string)), false);
});

test('урок закрыт порядком (sequential) — нет, после прохождения первого — да', async () => {
  assert.equal(yes(await can(U.lrn, F.seqSecond as string)), false);
  await db.sql`INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at) VALUES ('lrn', ${seq.lessonIds[0] as string}, ${seq.courseId}, 5)`;
  assert.equal(yes(await can(U.lrn, F.seqSecond as string)), true);
});

test('пониженный админ (роль в БД — learner) читает как обычный слушатель', async () => {
  assert.equal(yes(await can(U.demoted, F.pubOpen as string)), false);
  assert.equal(yes(await can(U.demoted, F.draftCourse as string)), false);
});

test('status=deleted — нет, даже админу', async () => {
  const f = await upload(pdf('del'), { purpose: 'lesson_material', courseId: pub.courseId, lessonId: pub.lessonIds[0] });
  await db.sql`UPDATE files SET status = 'deleted', deleted_at = 2 WHERE id = ${f.id}`;
  assert.equal(yes(await can(U.admin, f.id)), false);
});

test('обложка public опубликованного курса: гость — да (public), обложка черновика — нет', async () => {
  assert.deepEqual(await can(null, F.coverPublic as string), { ok: true, cache: 'public' });
  assert.equal(yes(await can(null, F.coverDraft as string)), false);
  assert.equal(yes(await can(U.lrn, F.coverDraft as string)), false);
});

test('обложка internal: член организации — да, чужой и гость — нет', async () => {
  assert.deepEqual(await can(U.member, F.coverInternal as string), { ok: true, cache: 'private' });
  assert.equal(yes(await can(U.oth, F.coverInternal as string)), false);
  assert.equal(yes(await can(null, F.coverInternal as string)), false);
});

test('обложка private: зачисленный — да, остальные — нет', async () => {
  assert.deepEqual(await can(U.lrn, F.coverPrivate as string), { ok: true, cache: 'private' });
  assert.equal(yes(await can(U.oth, F.coverPrivate as string)), false);
  assert.equal(yes(await can(null, F.coverPrivate as string)), false);
});

test('после revokeEnrollment доступ к материалу пропадает', async () => {
  await enroll({ userId: 'oth', courseId: pub.courseId, source: 'grant' });
  assert.equal(yes(await can(U.oth, F.pubOpen as string)), true);
  await revokeEnrollment('oth', pub.courseId, 'adm');
  assert.equal(yes(await can(U.oth, F.pubOpen as string)), false);
});

test('purpose=submission пока закрыт для всех, кроме админа', async () => {
  await db.sql`UPDATE files SET purpose = 'submission' WHERE id = ${F.unused as string}`;
  assert.equal(yes(await can(U.lrn, F.unused as string)), false);
  assert.equal(yes(await can(U.admin, F.unused as string)), true);
  await db.sql`UPDATE files SET purpose = 'lesson_material' WHERE id = ${F.unused as string}`;
});

test('публичное демо: файлы видит только админ, остальным — отказ как при отсутствии доступа', async () => {
  const back = setEnv({ DATABASE_URL: undefined, DEMO_MODE: '1' });
  try {
    assert.deepEqual(await can(U.admin, F.pubOpen as string), { ok: true, cache: 'private' });
    assert.deepEqual(await can(U.admin, F.draftCourse as string), { ok: true, cache: 'private' });
    // зачисленный слушатель, посторонний и гость; публичная обложка — тоже закрыта
    for (const id of [F.pubOpen, F.coverPublic, F.coverPrivate]) {
      for (const u of [U.lrn, U.oth, U.member, U.demoted, null]) assert.deepEqual(await can(u, id as string), { ok: false }, `${id} ${JSON.stringify(u)}`);
    }
  } finally {
    back();
  }
});

test('вне демо те же файлы доступны по обычным правилам (D-034)', async () => {
  assert.equal(yes(await can(U.lrn, F.pubOpen as string)), true);
  assert.equal(yes(await can(null, F.coverPublic as string)), true);
});
