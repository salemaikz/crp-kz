// CSV-выгрузка отчёта для Excel (русская локаль): UTF-8 с BOM, разделитель «;», строки через CRLF.
import { t as pick } from '../content/l10n';
import type { TeamReportRow, TeamRowStatus } from './types';

export const CSV_BOM = '﻿';
export const CSV_SEP = ';';

/**
 * Ячейка CSV. Строка, начинающаяся с = + - @ (или табуляции/CR), в Excel превращается в формулу:
 * ФИО или должность из БД не должны исполняться как формулы — добавляем ведущий апостроф.
 * Поля с «;», кавычкой или переводом строки берутся в кавычки.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type CsvLabels = {
  columns: {
    employee: string;
    email: string;
    position: string;
    course: string;
    progress: string;
    test: string;
    due: string;
    status: string;
    certificate: string;
  };
  status: Record<TeamRowStatus, string>;
};

/** Дата для Excel: 25.10.2026 (по Астане). */
export function csvDate(ms: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ms));
}

/** Колонки: ФИО, Email, Должность, Курс, Прогресс %, Тест %, Срок, Статус, Сертификат. */
export function reportToCsv(rows: readonly TeamReportRow[], labels: CsvLabels, locale: string): string {
  const c = labels.columns;
  const header = [c.employee, c.email, c.position, c.course, c.progress, c.test, c.due, c.status, c.certificate];
  const lines = [header.map(csvCell).join(CSV_SEP)];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.email,
        r.position,
        pick(r.courseTitle, locale),
        r.progress,
        r.quizScore,
        r.dueAt === null ? '' : csvDate(r.dueAt),
        labels.status[r.status],
        r.certificate?.number ?? '',
      ]
        .map(csvCell)
        .join(CSV_SEP),
    );
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
