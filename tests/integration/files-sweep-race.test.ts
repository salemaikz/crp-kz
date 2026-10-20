// Гонки на настоящем Postgres: подметание ↔ сохранение урока, квота при параллельных загрузках.
// PGlite однопоточен, настоящей параллельности в нём не бывает, поэтому без TEST_DATABASE_URL тесты пропускаются.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { AdminError, updateLesson } from '../../src/lib/admin';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { sweepOrphanFiles } from '../../src/lib/files/sweep';
import { admin, makeCourse, makeStorageDir, pdf, seedUsers, setEnv, upload, type TestCourse } from '../helpers/fileFixtures';

const PG = Boolean(process.env.TEST_DATABASE_URL?.trim());
const skip = PG ? false : 'нужен настоящий Postgres: TEST_DATABASE_URL';

let db: TestDb;
let storage: { dir: string; cleanup: () => Promise<void> };
let restore: () => void;
let c: TestCourse;

before(async () => {
  if (!PG) return;
  storage = await makeStorageDir();
  restore = setEnv({ FEATURE_UPLOADS: '1', STORAGE_DIR: storage.dir, UPLOAD_COURSE_QUOTA_BYTES: undefined });
  db = await createTestDb();
  await seedUsers(db);
  c = await makeCourse(db);
});
after(async () => {
  if (!PG) return;
  restore();
  await db.close();
  await storage.cleanup();
});

test('сохранение урока ↔ подметание: либо урок сохранён и файл жив, либо урок отклонён и файл удалён', { skip }, async () => {
  const lessonId = c.lessonIds[0] as string;
  let saved = 0;
  let rejected = 0;
  for (let i = 0; i < 30; i++) {
    const f = await upload(pdf(`race-${i}`), { purpose: 'lesson_material', courseId: c.courseId, lessonId });
    await db.sql`UPDATE files SET created_at = 1 WHERE id = ${f.id}`; // старый неиспользуемый файл
    const block = { id: `f${i}`, type: 'file', fileId: f.id, name: 'x', ext: 'pdf', sizeBytes: 1 };
    const [save, sweep] = await Promise.allSettled([
      updateLesson(admin, c.courseId, lessonId, { titleRu: 'Урок', status: 'draft', durationMin: '1', content: { ru: { v: 1, blocks: [block] } } }),
      sweepOrphanFiles({ limit: 1000 }),
    ]);
    assert.equal(sweep.status, 'fulfilled', String((sweep as PromiseRejectedResult).reason));

    const [file] = await db.sql<{ status: string }>`SELECT status FROM files WHERE id = ${f.id}`;
    const link = await db.sql`SELECT 1 FROM lesson_files WHERE lesson_id = ${lessonId} AND file_id = ${f.id}`;
    const [lesson] = await db.sql<{ content: { ru: { blocks: Array<{ fileId?: string }> } } }>`SELECT content FROM lessons WHERE id = ${lessonId}`;
    const inContent = lesson?.content.ru.blocks.some((b) => b.fileId === f.id) ?? false;

    if (save.status === 'fulfilled') {
      saved++;
      assert.equal(file?.status, 'active', 'урок сохранён — файл жив');
      assert.equal(link.length, 1);
      assert.equal(inContent, true);
    } else {
      rejected++;
      assert.ok(save.reason instanceof AdminError && save.reason.issues?.[0]?.code === 'file_not_found', String(save.reason));
      assert.equal(file?.status, 'deleted', 'урок отклонён — файл удалён');
      assert.equal(link.length, 0);
      assert.equal(inContent, false);
    }
    // ссылки на удалённый файл не бывает никогда
    const dangling = await db.sql`SELECT 1 FROM lesson_files lf JOIN files f ON f.id = lf.file_id WHERE f.status = 'deleted'`;
    assert.equal(dangling.length, 0);
  }
  assert.equal(saved + rejected, 30);
});

test('параллельные загрузки у границы квоты: сумма не превышает квоту, лишние объекты убраны', { skip }, async () => {
  const q = await makeCourse(db);
  const one = pdf('quota-0').length;
  const restoreQuota = setEnv({ UPLOAD_COURSE_QUOTA_BYTES: String(one * 4 + 5) });
  await db.sql`INSERT INTO users (id, email, name, role, created_at) VALUES
    ('adm2', 'adm2@x.kz', 'Админ 2', 'admin', 1), ('adm3', 'adm3@x.kz', 'Админ 3', 'admin', 1)`;
  try {
    const args = { purpose: 'lesson_material' as const, courseId: q.courseId, lessonId: q.lessonIds[0] };
    // три администратора по три загрузки: на одного приходится не больше трёх одновременных
    const actors = ['adm', 'adm2', 'adm3'].map((id) => ({ id, role: 'admin' }));
    const results = await Promise.allSettled(
      Array.from({ length: 9 }, (_, i) => upload(pdf(`quota-${i}`), { ...args, actor: actors[i % 3] })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(ok, 4);
    for (const r of results) if (r.status === 'rejected') assert.equal((r.reason as { code?: string }).code, 'quota');
    const [sum] = await db.sql<{ s: number }>`SELECT COALESCE(SUM(size_bytes), 0)::float8 AS s FROM files WHERE course_id = ${q.courseId} AND status = 'active'`;
    assert.ok((sum?.s ?? 0) <= one * 4 + 5);
    const keys = (await db.sql<{ storageKey: string }>`SELECT storage_key FROM files WHERE status = 'active'`).map((k) => k.storageKey).sort();
    const root = path.join(storage.dir, 'objects');
    const onDisk: string[] = [];
    for (const d of await readdir(root)) for (const f of await readdir(path.join(root, d))) onDisk.push(`${d}/${f}`);
    assert.deepEqual(onDisk.sort(), keys, 'объекты на диске = активные строки');
  } finally {
    restoreQuota();
  }
});
