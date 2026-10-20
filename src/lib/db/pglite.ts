// Драйвер PGlite (демо-режим): встроенный Postgres в памяти или в папке PGLITE_DIR.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { createTxScope, isJsonParam, jsonParam, toCamel, type DbHandle, type Row, type Sql, type TxConn } from './core';

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
    if (isJsonParam(v)) {
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

function makeConn(target: Target, inTx = false): TxConn {
  const conn: TxConn = {
    sql: makeSql(target),
    exec: async (script) => {
      await target.exec(script);
    },
  };
  if (inTx) {
    // Точки сохранения на соединении транзакции: SAVEPOINT / ROLLBACK TO / RELEASE.
    // Имена уникальны в пределах транзакции; вложенность — стек (см. createTxScope.nested).
    let counter = 0;
    conn.savepoint = async <T>(fn: (c: TxConn) => Promise<T>): Promise<T> => {
      const name = `crp_sp_${++counter}`;
      await target.exec(`SAVEPOINT ${name}`);
      let result: T;
      try {
        result = await fn(conn);
      } catch (e) {
        await target.exec(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
        throw e;
      }
      await target.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    };
  }
  return conn;
}

/** Опции создания PGlite. Снимок — tar.gz от dumpDataDir('gzip'); ломаный/отсутствующий снимок не фатален. */
export interface PgliteOpenOptions {
  dataDir?: string;
  snapshotPath?: string;
}

/** Поднять экземпляр PGlite; со снимком — без initdb (~0,6 с вместо 5–7 с), иначе с нуля. */
export async function openPglite(opts: PgliteOpenOptions = {}): Promise<PGlite> {
  const { PGlite } = await import('@electric-sql/pglite');
  const base = {
    ...(opts.dataDir ? { dataDir: opts.dataDir } : {}),
    // int8 → number, как в драйвере postgres (count(*), BIGINT-время, деньги)
    parsers: { [INT8_OID]: (v: string) => Number(v) },
  };
  if (opts.snapshotPath) {
    let pg: PGlite | undefined;
    try {
      // Распаковываем сами и синхронно: битый gzip падает здесь, в нашем try, а не
      // необработанным отказом внутри PGlite. PGlite получает уже несжатый tar.
      const tar = gunzipSync(readFileSync(opts.snapshotPath));
      pg = new PGlite({ ...base, loadDataDir: new Blob([new Uint8Array(tar)]) });
      await pg.waitReady;
      return pg;
    } catch (e) {
      await pg?.close().catch(() => {});
      console.warn('PGlite: снимок не загружен, создаю базу с нуля:', (e instanceof Error && e.cause) || e);
    }
  }
  return PGlite.create(base);
}

export async function createPgliteDb(dataDir?: string, opts: { snapshotPath?: string } = {}): Promise<DbHandle> {
  return wrapPglite(await openPglite({ dataDir, snapshotPath: opts.snapshotPath }));
}

export function wrapPglite(pg: PGlite): DbHandle {
  const scope = createTxScope();
  const base = makeConn(pg);

  const withTx = async <T>(fn: (conn: TxConn) => Promise<T>): Promise<T> => {
    // вложенная транзакция — SAVEPOINT внутри текущей
    if (scope.current()) return scope.nested(fn);
    return pg.transaction((t) => scope.run(makeConn(t, true), fn));
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
