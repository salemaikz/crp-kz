// Подметание: сироты, бесхозные объекты, временные файлы, dryRun; скрипт files-sweep (в том числе при выключенном флаге).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { deleteLesson } from '../../src/lib/admin/structure';
import { updateLesson } from '../../src/lib/admin';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { createPgliteDb } from '../../src/lib/db/pglite';
import { migrate } from '../../src/lib/db/migrate';
import { setCourseCover } from '../../src/lib/files/admin';
import { sweepOrphanFiles, sweepStrayObjects, sweepTemp } from '../../src/lib/files/sweep';
import { newStorageKey } from '../../src/lib/storage/keys';
import { UPLOAD_LIMITS } from '../../src/lib/storage/limits';
import { admin, makeCourse, makeStorageDir, pdf, png, seedUsers, setEnv, upload, type TestCourse } from '../helpers/fileFixtures';

const ROOT = path.join(import.meta.dirname, '..', '..');
const DAY = 24 * 60 * 60_000;

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;
let c: TestCourse;

before(async () => {
  storage = await makeStorageDir();
  restore = setEnv({ FEATURE_UPLOADS: '1', STORAGE_DIR: storage.dir });
  db = await createTestDb();
  await seedUsers(db);
  c = await makeCourse(db, { lessons: 2 });
});
after(async () => {
  restore();
  await db.close();
  await storage.cleanup();
});

const material = (tag: string, lessonIdx = 0) =>
  upload(pdf(tag), { purpose: 'lesson_material', courseId: c.courseId, lessonId: c.lessonIds[lessonIdx] });
const objectPath = async (id: string) => {
  const [row] = await db.sql<{ storageKey: string }>`SELECT storage_key FROM files WHERE id = ${id}`;
  return path.join(storage.dir, 'objects', row!.storageKey);
};
const exists = (p: string) => access(p).then(() => true, () => false);
const statusOf = async (id: string) => (await db.sql<{ status: string }>`SELECT status FROM files WHERE id = ${id}`)[0]?.status;

async function linkInLesson(fileId: string, lessonId: string): Promise<void> {
  await updateLesson(admin, c.courseId, lessonId, {
    titleRu: 'Урок',
    status: 'draft',
    durationMin: '1',
    content: { ru: { v: 1, blocks: [{ id: 'f', type: 'file', fileId, name: 'x', ext: 'pdf', sizeBytes: 1 }] } },
  });
}

test('сирота старше 24 ч → deleted, объект удалён, журнал file.purge без автора', async () => {
  const f = await material('orphan');
  const p = await objectPath(f.id);
  const res = await sweepOrphanFiles({ nowMs: Date.now() + DAY + 60_000 });
  assert.ok(res.deleted.includes(f.id));
  assert.deepEqual(res.objectErrors, []);
  assert.equal(await statusOf(f.id), 'deleted');
  assert.equal(await exists(p), false);
  const [a] = await db.sql<{ actorId: string | null; entity: string; meta: unknown }>`SELECT actor_id, entity, meta FROM audit_log WHERE action = 'file.purge' AND entity_id = ${f.id}`;
  assert.deepEqual([a?.actorId, a?.entity, a?.meta], [null, 'file', { reason: 'orphan' }]);
});

test('младше 24 ч, используемый уроком и текущая обложка не трогаются', async () => {
  const fresh = await material('fresh');
  const used = await material('used');
  await linkInLesson(used.id, c.lessonIds[0] as string);
  const cov = await upload(png(1200, 675), { purpose: 'course_cover', courseId: c.courseId });
  await setCourseCover(admin, c.courseId, cov.id);

  const now = await sweepOrphanFiles();
  assert.equal(now.deleted.includes(fresh.id), false);
  const later = await sweepOrphanFiles({ nowMs: Date.now() + 3 * DAY });
  assert.equal(later.deleted.includes(fresh.id), true);
  assert.equal(later.deleted.includes(used.id), false);
  assert.equal(later.deleted.includes(cov.id), false);
  assert.equal(await statusOf(used.id), 'active');
  assert.equal(await statusOf(cov.id), 'active');
});

test('после deleteLesson файл становится сиротой и подметается', async () => {
  const f = await material('lesson-gone', 1);
  await linkInLesson(f.id, c.lessonIds[1] as string);
  assert.equal((await sweepOrphanFiles({ nowMs: Date.now() + 3 * DAY })).deleted.includes(f.id), false);
  await deleteLesson(admin, c.lessonIds[1] as string);
  assert.equal((await sweepOrphanFiles({ nowMs: Date.now() + 3 * DAY })).deleted.includes(f.id), true);
});

test('dryRun ничего не меняет; работает при выключенном флаге UPLOADS', async () => {
  const f = await material('dry');
  const p = await objectPath(f.id);
  const dry = await sweepOrphanFiles({ nowMs: Date.now() + 3 * DAY, dryRun: true });
  assert.ok(dry.deleted.includes(f.id));
  assert.equal(await statusOf(f.id), 'active');
  assert.equal(await exists(p), true);

  const off = setEnv({ FEATURE_UPLOADS: '0' });
  try {
    const real = await sweepOrphanFiles({ nowMs: Date.now() + 3 * DAY });
    assert.ok(real.deleted.includes(f.id));
  } finally {
    off();
  }
  assert.equal(await statusOf(f.id), 'deleted');
  assert.equal(await exists(p), false);
});

test('sweepStrayObjects: объект без строки старше часа удаляется, с активной строкой и свежий — остаются', async () => {
  const keep = await material('keep');
  const keepPath = await objectPath(keep.id);
  const old = new Date(Date.now() - 2 * 60 * 60_000);
  await utimes(keepPath, old, old);

  const strayKey = newStorageKey();
  const strayPath = path.join(storage.dir, 'objects', strayKey);
  await mkdir(path.dirname(strayPath), { recursive: true });
  await writeFile(strayPath, 'stray');
  await utimes(strayPath, old, old);

  const freshKey = newStorageKey();
  const freshPath = path.join(storage.dir, 'objects', freshKey);
  await mkdir(path.dirname(freshPath), { recursive: true });
  await writeFile(freshPath, 'fresh');

  const dry = await sweepStrayObjects({ dryRun: true });
  assert.deepEqual(dry.removed, [strayKey]);
  assert.equal(await exists(strayPath), true);

  const res = await sweepStrayObjects();
  assert.deepEqual(res.removed, [strayKey]);
  assert.equal(await exists(strayPath), false);
  assert.equal(await exists(freshPath), true, 'свежий объект: загрузка могла ещё не записать строку');
  assert.equal(await exists(keepPath), true);
});

test('sweepTemp удаляет только старые временные файлы', async () => {
  const tmp = path.join(storage.dir, '.tmp');
  const stale = path.join(tmp, 'stale');
  const fresh = path.join(tmp, 'fresh');
  await writeFile(stale, 'x');
  await writeFile(fresh, 'x');
  const old = new Date(Date.now() - UPLOAD_LIMITS.tempGraceMs - 60_000);
  await utimes(stale, old, old);
  assert.equal(await sweepTemp(), 1);
  assert.deepEqual((await readdir(tmp)).sort(), ['fresh']);
  await rm(fresh);
});

// ---------- скрипт ----------

function runScript(env: Record<string, string>, args: string[] = []) {
  const clean = { ...process.env };
  for (const k of ['DATABASE_URL', 'TEST_DATABASE_URL', 'DEMO_MODE', 'NODE_TEST_CONTEXT', 'FEATURE_UPLOADS', 'STORAGE_DIR', 'PGLITE_DIR']) delete clean[k];
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts/files-sweep.ts'), ...args], {
    cwd: ROOT,
    env: { ...clean, ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
}

test('scripts/files-sweep.ts: при выключенном флаге подметает (К-11), в лог — счётчики без имён', async () => {
  const pgDir = await mkdtemp(path.join(tmpdir(), 'crp-sweep-db-'));
  const store = await makeStorageDir();
  try {
    // БД на диске: схема, один курс, один старый неиспользуемый файл и его объект
    const handle = await createPgliteDb(pgDir);
    await migrate(handle);
    await handle.sql`INSERT INTO users (id, email, name, role, created_at) VALUES ('adm', 'adm@x.kz', 'Админ', 'admin', 1)`;
    await handle.sql`INSERT INTO courses (id, slug, title, level, duration_min, visibility, status, position, created_at, updated_at)
      VALUES ('c1', 'c1', ${handle.json({ ru: 'К' })}, 'base', 1, 'public', 'draft', 0, 1, 1)`;
    const key = newStorageKey();
    await handle.sql`
      INSERT INTO files (id, storage, storage_key, purpose, kind, mime, ext, size_bytes, sha256, original_name, course_id, status, created_at)
      VALUES ('77777777-7777-4777-8777-777777777777', 'local', ${key}, 'lesson_material', 'document', 'application/pdf', 'pdf', 5,
              ${'b'.repeat(64)}, 'Секретный договор.pdf', 'c1', 'active', 1)`;
    await handle.close();
    const objectFile = path.join(store.dir, 'objects', key);
    await mkdir(path.dirname(objectFile), { recursive: true });
    await writeFile(objectFile, 'hello');

    const res = runScript({ PGLITE_DIR: pgDir, STORAGE_DIR: store.dir, FEATURE_UPLOADS: '0' });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /Неиспользуемых файлов: 1/);
    assert.equal(/Секретный|договор/.test(res.stdout + res.stderr), false, 'имена файлов в лог не попадают');
    assert.equal(await exists(objectFile), false);

    const check = await createPgliteDb(pgDir);
    const [row] = await check.sql<{ status: string }>`SELECT status FROM files WHERE id = '77777777-7777-4777-8777-777777777777'`;
    assert.equal(row?.status, 'deleted');
    const [audit] = await check.sql<{ actorId: string | null }>`SELECT actor_id FROM audit_log WHERE action = 'file.purge'`;
    assert.equal(audit?.actorId, null);
    await check.close();
  } finally {
    await rm(pgDir, { recursive: true, force: true });
    await store.cleanup();
  }
});

test('scripts/files-sweep.ts: без хранилища — сообщение и код 0; лишний аргумент — код 1', async () => {
  const pgDir = await mkdtemp(path.join(tmpdir(), 'crp-sweep-db-'));
  try {
    const handle = await createPgliteDb(pgDir);
    await migrate(handle);
    await handle.close();
    const res = runScript({ PGLITE_DIR: pgDir, STORAGE_DIR: 'relative/dir' });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /Хранилище файлов недоступно \(relative_path\)/);
    assert.equal(runScript({ PGLITE_DIR: pgDir }, ['--bogus']).status, 1);
  } finally {
    await rm(pgDir, { recursive: true, force: true });
  }
});
