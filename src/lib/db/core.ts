// Общие типы слоя БД и служебные части драйверов. Нормативно: docs/lms/BUILD.md §2.
import { AsyncLocalStorage } from 'node:async_hooks';

export type Row = Record<string, unknown>;

export interface Sql {
  <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
}

export interface Db {
  sql: Sql;
  /** Транзакция. Внутри колбэка любой вызов db.sql/db.tx тоже идёт в эту транзакцию. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  /** Параметр для колонок jsonb: ${db.json(v)}. */
  json(value: unknown): unknown;
  driver: 'postgres' | 'pglite';
}

/** Соединение внутри транзакции с доступом к многооператорным скриптам (миграции, сид). */
export interface TxConn {
  sql: Sql;
  exec(script: string): Promise<void>;
}

/** Внутренний интерфейс: то, что нужно миграциям, сиду и тестам. Приложение работает с Db. */
export interface DbHandle extends Db {
  /** Скрипт из нескольких команд без параметров. Только для миграций. */
  exec(script: string): Promise<void>;
  /** Транзакция с exec. Только для миграций и сида. */
  withTx<T>(fn: (conn: TxConn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Маркер jsonb-параметра; драйвер превращает его в типизированный параметр jsonb. */
export class JsonParam {
  constructor(readonly value: unknown) {}
}

export function jsonParam(value: unknown): JsonParam {
  if (value === undefined) throw new Error('db.json(undefined) is not allowed');
  return new JsonParam(value);
}

/** snake_case → camelCase, ровно как postgres.toCamel (для одинаковых ключей в обоих драйверах). */
export function toCamel(x: string): string {
  let str = x[0] ?? '';
  for (let i = 1; i < x.length; i++) {
    const ch = x[i];
    if (ch === '_' && i + 1 < x.length) str += (x[++i] as string).toUpperCase();
    else str += ch;
  }
  return str;
}

/**
 * Область транзакции на AsyncLocalStorage: вызовы db.sql/db.tx изнутри колбэка транзакции
 * уходят в ту же транзакцию. Без этого PGlite (одно соединение) зависал бы, а Postgres
 * выполнял бы запрос мимо транзакции. Поведение одинаково в обоих драйверах.
 */
export function createTxScope() {
  const als = new AsyncLocalStorage<{ conn: TxConn; done: boolean }>();
  return {
    current(): TxConn | null {
      const s = als.getStore();
      return s && !s.done ? s.conn : null;
    },
    async run<T>(conn: TxConn, fn: (conn: TxConn) => Promise<T>): Promise<T> {
      const store = { conn, done: false };
      try {
        return await als.run(store, () => fn(conn));
      } finally {
        // запросы, «забытые» после конца транзакции, пойдут уже мимо неё
        store.done = true;
      }
    },
  };
}

/** Нарушение уникальности (код Postgres 23505) — одинаково для обоих драйверов. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}
