// Драйвер postgres.js (прод и разработка с DATABASE_URL).
import type { Sql as PgSql, TransactionSql } from 'postgres';
import { createTxScope, JsonParam, jsonParam, type DbHandle, type Row, type Sql, type TxConn } from './core';

type Target = PgSql | TransactionSql;

function makeConn(target: Target): TxConn {
  const sql = (async <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    const res = await target(
      strings,
      // jsonb-маркер → типизированный параметр postgres.js; остальное как есть
      ...(values.map((v) => (v instanceof JsonParam ? target.json(v.value as never) : v)) as never[]),
    );
    // Строки postgres.js — объекты без прототипа в подклассе Array; React Flight такие не
    // сериализует. Приводим к обычным объектам — как в PGlite.
    return Array.from(res as unknown as Row[], (r) => ({ ...r }) as T);
  }) as Sql;
  return {
    sql,
    exec: async (script) => {
      await target.unsafe(script);
    },
  };
}

/** opts.schema — search_path соединений (изолированные схемы для тестов на Postgres). */
export async function createPostgresDb(url: string, opts: { schema?: string } = {}): Promise<DbHandle> {
  const postgres = (await import('postgres')).default;
  const client = postgres(url, {
    // Ключи строк snake_case → camelCase. Трансформ значений postgres.camel не включаем:
    // он переименовывает ключи внутри jsonb, и jsonb перестаёт возвращаться как записан.
    transform: { column: { from: postgres.toCamel } },
    // int8 → number (BIGINT-время и деньги в целых тенге — в пределах Number.MAX_SAFE_INTEGER)
    types: {
      int8: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
    max: Number(process.env.DB_POOL_MAX) || 10,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    ...(opts.schema ? { connection: { search_path: opts.schema } } : {}),
  });
  const scope = createTxScope();
  const base = makeConn(client);

  const withTx = async <T>(fn: (conn: TxConn) => Promise<T>): Promise<T> => {
    const cur = scope.current();
    if (cur) return fn(cur); // вложенная транзакция = та же транзакция
    return client.begin((t) => scope.run(makeConn(t), fn)) as Promise<T>;
  };

  const sql = (<T = Row>(strings: TemplateStringsArray, ...values: unknown[]) =>
    (scope.current() ?? base).sql<T>(strings, ...values)) as Sql;

  return {
    driver: 'postgres',
    sql,
    tx: (fn) => withTx((c) => fn(c.sql)),
    json: jsonParam,
    exec: (script) => (scope.current() ?? base).exec(script),
    withTx,
    close: () => client.end({ timeout: 5 }),
  };
}
