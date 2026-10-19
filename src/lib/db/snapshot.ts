// Полный снимок демо-базы (схема + сид) и сдвиг времени при его загрузке.
// Зачем: сид на слабом CPU serverless-функции занимает ~4 с, поэтому сид делаем в сборке,
// а при старте сдвигаем все метки времени на разницу «сейчас − время сборки» — даты демо свежие.
import { readFile } from 'node:fs/promises';
import type { DbHandle } from './core';

/** Описание снимка рядом с файлом: .demo/pglite-snapshot.json. */
export interface SnapshotMeta {
  builtAt: number;
  seeded: boolean;
}

export function snapshotMetaPath(snapshotFile: string): string {
  return snapshotFile.replace(/\.tar\.gz$/, '.json');
}

export async function readSnapshotMeta(snapshotFile: string): Promise<SnapshotMeta | null> {
  try {
    const m = JSON.parse(await readFile(snapshotMetaPath(snapshotFile), 'utf8')) as Partial<SnapshotMeta>;
    return typeof m.builtAt === 'number' && m.seeded === true ? { builtAt: m.builtAt, seeded: true } : null;
  } catch {
    return null;
  }
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;

/**
 * Сдвинуть все временные колонки (BIGINT с суффиксом _at, кроме schema_migrations) на delta мс.
 * Колонки берутся из каталога; деньги (*_kzt) и прочие BIGINT не трогаются.
 * Схема гарантирует суффикс _at у всех временных колонок — тест tests/integration/demo-snapshot.test.ts.
 */
export async function shiftTimestamps(db: DbHandle, delta: number): Promise<number> {
  if (!Number.isSafeInteger(delta) || delta <= 0) return 0;
  return db.withTx(async (c) => {
    const cols = await c.sql<{ tableName: string; columnName: string }>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'bigint'
        AND column_name LIKE '%\\_at' ESCAPE '\\' AND table_name <> 'schema_migrations'
      ORDER BY table_name, column_name`;
    // delta — проверенное целое, имена — из каталога БД и экранированы: подстановка безопасна
    for (const { tableName, columnName } of cols) {
      const col = quote(columnName);
      await c.exec(`UPDATE ${quote(tableName)} SET ${col} = ${col} + ${delta} WHERE ${col} IS NOT NULL`);
    }
    return cols.length;
  });
}

/** Если в базе загружен снимок с сидом — сдвинуть время до текущего момента. */
export async function refreshSnapshotTime(db: DbHandle, snapshotFile: string, nowMs = Date.now()): Promise<void> {
  const meta = await readSnapshotMeta(snapshotFile);
  if (meta) await shiftTimestamps(db, nowMs - meta.builtAt);
}
