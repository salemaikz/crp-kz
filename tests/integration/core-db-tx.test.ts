// Вложенные db.tx = SAVEPOINT: ошибка внутри откатывает только вложенную часть.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { isUniqueViolation } from '../../src/lib/db';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  await db.close();
});

async function emails(prefix: string): Promise<string[]> {
  const rows = await db.sql<{ email: string }>`
    SELECT email FROM users WHERE email LIKE ${prefix + '%'} ORDER BY email`;
  return rows.map((r) => r.email);
}

async function addUser(sql: typeof db.sql, id: string, email: string) {
  await sql`INSERT INTO users (id, email, name, created_at) VALUES (${id}, ${email}, 'X', 1)`;
}

test('пойманная ошибка уникальности во вложенной tx не ломает внешнюю', async () => {
  await db.tx(async (sql) => {
    await addUser(sql, 'a1', 'sp-a1@x.kz');
    let caught = false;
    try {
      await db.tx(async (inner) => {
        await addUser(inner, 'a2', 'sp-a2@x.kz'); // откатится вместе со вложенной частью
        await addUser(inner, 'a3', 'sp-a1@x.kz'); // дубль email
      });
    } catch (e) {
      caught = isUniqueViolation(e);
    }
    assert.equal(caught, true);
    // внешняя транзакция жива: запросы работают, в том числе через db.sql
    await addUser(sql, 'a4', 'sp-a4@x.kz');
    await addUser(db.sql, 'a5', 'sp-a5@x.kz');
  });
  assert.deepEqual(await emails('sp-a'), ['sp-a1@x.kz', 'sp-a4@x.kz', 'sp-a5@x.kz']);
});

test('успешная вложенная tx фиксируется только вместе с внешней', async () => {
  await assert.rejects(
    db.tx(async (sql) => {
      await db.tx(async (inner) => addUser(inner, 'b1', 'sp-b1@x.kz'));
      assert.deepEqual(
        (await sql<{ email: string }>`SELECT email FROM users WHERE email = 'sp-b1@x.kz'`).map((r) => r.email),
        ['sp-b1@x.kz'],
      );
      throw new Error('outer rollback');
    }),
    /outer rollback/,
  );
  assert.deepEqual(await emails('sp-b'), []);
});

test('вложенность в несколько уровней и соседние вложенные tx (по очереди)', async () => {
  await db.tx(async () => {
    await db.tx(async (l1) => {
      await addUser(l1, 'c1', 'sp-c1@x.kz');
      await assert.rejects(
        db.tx(async (l2) => {
          await addUser(l2, 'c2', 'sp-c2@x.kz');
          throw new Error('inner');
        }),
        /inner/,
      );
      await addUser(l1, 'c3', 'sp-c3@x.kz');
    });
    // параллельно запущенные соседние вложенные tx не путают точки сохранения
    const results = await Promise.allSettled([
      db.tx(async (s) => addUser(s, 'c4', 'sp-c4@x.kz')),
      db.tx(async (s) => {
        await addUser(s, 'c5', 'sp-c5@x.kz');
        await addUser(s, 'c6', 'sp-c4@x.kz'); // дубль — откатывает только эту ветку
      }),
      db.tx(async (s) => addUser(s, 'c7', 'sp-c7@x.kz')),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'rejected', 'fulfilled'],
    );
  });
  assert.deepEqual(await emails('sp-c'), ['sp-c1@x.kz', 'sp-c3@x.kz', 'sp-c4@x.kz', 'sp-c7@x.kz']);
});

test('без внешней транзакции ошибка tx откатывает всё', async () => {
  await assert.rejects(
    db.tx(async (sql) => {
      await addUser(sql, 'd1', 'sp-d1@x.kz');
      await addUser(sql, 'd2', 'sp-d1@x.kz');
    }),
    (e: unknown) => isUniqueViolation(e),
  );
  assert.deepEqual(await emails('sp-d'), []);
});
