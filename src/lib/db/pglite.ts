// Драйвер PGlite (демо-режим): встроенный Postgres в памяти или в папке PGLITE_DIR.
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { createTxScope, JsonParam, jsonParam, toCamel, type DbHandle, type Row, type Sql, type TxConn } from './core';

const INT8_OID = 20;
const JSONB_OID = 3802;

type Target = Pick<PGlite | Transaction, 'query' | 'exec'>;

/** Tagged template → текст с $1..$n и массив значений. */
function toQuery(strings: TemplateStringsArray, values: unknown[]) {
  let text = strings[0] ?? '';
  const params: unknown[] = [];
  let paramTypes: number[] | undefined;
  values.forEach((v, i) => {
    if (v === undefined) throw new Error('UNDEFINED_VALUE: Undefined values are not allowed');
    if (v instanceof JsonParam) {
      paramTypes ??= values.map(() => 0);
      paramTypes[i] = JSONB_OID;
      params.push(JSON.stringify(v.value));
    } else {
      params.push(v);
    }
    text += `$${i + 1}${strings[i + 1] ?? ''}`;
  });
  return { text, params, paramTypes };
}

function makeSql(target: Target): Sql {
  return (async <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    const { text, params, paramTypes } = toQuery(strings, values);
    const res = await target.query<Row>(text, params, paramTypes ? { paramTypes } : undefined);
    const names = res.fields.map((f) => f.name);
    const keys = names.map(toCamel);
    return res.rows.map((r) => {
      const out: Row = {};
      for (let i = 0; i < names.length; i++) out[keys[i] as string] = r[names[i] as string];
      return out as T;
    });
  }) as Sql;
}

function makeConn(target: Target): TxConn {
  return {
    sql: makeSql(target),
    exec: async (script) => {
      await target.exec(script);
    },
  };
}

export async function createPgliteDb(dataDir?: string): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = await PGlite.create({
    ...(dataDir ? { dataDir } : {}),
    // int8 → number, как в драйвере postgres (count(*), BIGINT-время, деньги)
    parsers: { [INT8_OID]: (v: string) => Number(v) },
  });
  const scope = createTxScope();
  const base = makeConn(pg);

  const withTx = async <T>(fn: (conn: TxConn) => Promise<T>): Promise<T> => {
    const cur = scope.current();
    if (cur) return fn(cur); // вложенная транзакция = та же транзакция
    return pg.transaction((t) => scope.run(makeConn(t), fn));
  };

  const sql = (<T = Row>(strings: TemplateStringsArray, ...values: unknown[]) =>
    (scope.current() ?? base).sql<T>(strings, ...values)) as Sql;

  return {
    driver: 'pglite',
    sql,
    tx: (fn) => withTx((c) => fn(c.sql)),
    json: jsonParam,
    exec: (script) => (scope.current() ?? base).exec(script),
    withTx,
    close: () => pg.close(),
  };
}
