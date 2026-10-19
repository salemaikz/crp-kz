// Полный снимок демо-базы (схема + сид) и сдвиг времени при его загрузке.
// Зачем: сид на слабом CPU serverless-функции занимает ~4 с, поэтому сид делаем в сборке,
// а при старте сдвигаем все метки времени на целое число суток (база сида «сейчас» − база сида при сборке) —
// даты демо свежие, а время суток событий не плывёт.
import { readFile } from 'node:fs/promises';
import type { DbHandle } from './core';
import { seedBase } from './seed/time';

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
 * Колонки берутся из каталога, только у обычных таблиц (представления считали бы сдвиг дважды);
 * деньги (*_kzt) и прочие BIGINT не трогаются. По одному UPDATE на таблицу со всеми её колонками
 * сразу: так не нарушатся будущие CHECK между временными колонками (например, expires_at > created_at).
 * Схема гарантирует суффикс _at у всех временных колонок — тест tests/integration/demo-snapshot.test.ts.
 * Возвращает число сдвинутых колонок.
 */
export async function shiftTimestamps(db: DbHandle, delta: number): Promise<number> {
  if (!Number.isSafeInteger(delta) || delta <= 0) return 0;
  return db.withTx(async (c) => {
    const cols = await c.sql<{ tableName: string; columnName: string }>`
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.data_type = 'bigint'
        AND c.column_name LIKE '%\\_at' ESCAPE '\\' AND c.table_name <> 'schema_migrations'
      ORDER BY c.table_name, c.column_name`;
    const byTable = new Map<string, string[]>();
    for (const { tableName, columnName } of cols) byTable.set(tableName, [...(byTable.get(tableName) ?? []), columnName]);
    // delta — проверенное целое, имена — из каталога БД и экранированы: подстановка безопасна
    for (const [table, columns] of byTable) {
      const set = columns.map((n) => `${quote(n)} = ${quote(n)} + ${delta}`).join(', ');
      const any = columns.map((n) => `${quote(n)} IS NOT NULL`).join(' OR ');
      await c.exec(`UPDATE ${quote(table)} SET ${set} WHERE ${any}`);
    }
    return cols.length;
  });
}

/**
 * Если в базе загружен снимок с сидом — сдвинуть время до текущего момента. Сдвиг кратен суткам
 * (разница баз сида seedBase(now) − seedBase(builtAt)): время суток событий сида не плывёт.
 * Нет описания снимка (.json рядом с файлом) — сдвига не будет, об этом предупреждаем.
 */
export async function refreshSnapshotTime(db: DbHandle, snapshotFile: string, nowMs = Date.now()): Promise<void> {
  const meta = await readSnapshotMeta(snapshotFile);
  if (!meta) {
    console.warn(`Снимок демо-базы загружен, но описание ${snapshotMetaPath(snapshotFile)} не найдено или повреждено: даты сида не сдвинуты`);
    return;
  }
  await shiftTimestamps(db, seedBase(nowMs) - seedBase(meta.builtAt));
}
