// Параллельные воркеры на настоящем Postgres: каждое письмо отправляется ровно один раз.
// PGlite однопоточен, настоящей параллельности в нём не бывает, поэтому без TEST_DATABASE_URL тесты пропускаются.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import type { MailTransport } from '../../src/lib/mail/transport';
import { deliverPending } from '../../src/lib/mail/worker';

const PG = Boolean(process.env.TEST_DATABASE_URL?.trim());
const skip = PG ? false : 'нужен настоящий Postgres: TEST_DATABASE_URL';
const T0 = 1_800_000_000_000;

let db: TestDb;
let savedFrom: string | undefined;

before(async () => {
  if (!PG) return;
  savedFrom = process.env.MAIL_FROM;
  process.env.MAIL_FROM = 'noreply@example.kz';
  db = await createTestDb();
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'u1@x.kz', 'Первый', 1)`;
});
after(async () => {
  if (!PG) return;
  if (savedFrom === undefined) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = savedFrom;
  await db.close();
});

test('два воркера параллельно на 30 письмах: каждое отправлено ровно один раз', { skip }, async () => {
  for (let i = 0; i < 30; i++) {
    await db.sql`
      INSERT INTO mail_outbox (id, category, template, locale, user_id, to_email, params, status, attempts, created_at, updated_at)
      VALUES (${'c' + String(i).padStart(2, '0')}, 'notice', 'assignment_new', 'ru', 'u1', ${`to${i}@example.kz`},
              ${db.json({ name: 'Первый', courseSlug: 'c1', courseTitle: { ru: 'Курс' }, dueAt: null })}, 'queued', 0, ${T0 + i}, ${T0 + i})`;
  }
  const sent: string[] = [];
  const transport: MailTransport = {
    name: 'smtp',
    async send(m) {
      sent.push(m.id);
      await new Promise((r) => setTimeout(r, 5));
      return {};
    },
  };
  const results = await Promise.all([
    deliverPending({ transport, nowMs: T0 + 1000, batch: 20 }),
    deliverPending({ transport, nowMs: T0 + 1000, batch: 20 }),
  ]);
  // остаток, если пачки пересеклись и один воркер взял меньше
  const rest = await deliverPending({ transport, nowMs: T0 + 1000, batch: 20 });

  assert.equal(sent.length, 30);
  assert.equal(new Set(sent).size, 30, 'повторных отправок нет');
  assert.equal(results[0].sent + results[1].sent + rest.sent, 30);
  const [row] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox WHERE status = 'sent' AND attempts = 1`;
  assert.equal(row?.n, 30);
});
