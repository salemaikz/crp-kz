// Ссылки урока на файлы: извлечение из контента (блоки и Markdown), проверка по БД, переписывание
// снимков и таблица lesson_files. Вызывается из updateLesson внутри транзакции после FOR UPDATE урока.
import { AdminError, type ContentIssue } from '../admin/errors';
import type { Block, LessonContent, LessonDoc } from '../content/types';
import type { Sql } from '../db';
import type { FileExt, FileKind } from '../storage/limits';
import { FILE_URL_RE } from './url';

export type FileRef = {
  locale: 'ru' | 'kz';
  blockIndex: number;
  fileId: string;
  field: 'fileId' | 'markdown';
  need: 'image' | 'any';
};

const LOCALES = ['ru', 'kz'] as const;

// ![alt](url) и [текст](url); в тексте ссылки допускается один уровень вложенных скобок.
const INLINE_LINK_RE = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]*)/g;
// [id]: url — определения ссылок; как будет использована, неизвестно, поэтому «любой вид».
const DEFINITION_RE = /^[ ]{0,3}\[[^\]]+\]:\s*<?(\S+)/gm;

function idsIn(target: string): string[] {
  return [...target.matchAll(FILE_URL_RE)].map((m) => (m[1] as string).toLowerCase());
}

function markdownRefs(markdown: string): Array<{ fileId: string; need: 'image' | 'any' }> {
  const out: Array<{ fileId: string; need: 'image' | 'any' }> = [];
  for (const m of markdown.matchAll(INLINE_LINK_RE)) {
    const need = m[1] === '!' ? 'image' : 'any';
    for (const fileId of idsIn(m[3] as string)) out.push({ fileId, need });
  }
  for (const m of markdown.matchAll(DEFINITION_RE)) {
    for (const fileId of idsIn(m[1] as string)) out.push({ fileId, need: 'any' });
  }
  return out;
}

/** Все ссылки на файлы в контенте обеих локалей, в порядке блоков (дубликаты сохраняются). */
export function collectFileRefs(content: LessonContent): FileRef[] {
  const out: FileRef[] = [];
  for (const locale of LOCALES) {
    const doc: LessonDoc | undefined = content[locale];
    doc?.blocks.forEach((b: Block, blockIndex) => {
      if (b.type === 'image') out.push({ locale, blockIndex, fileId: b.fileId.toLowerCase(), field: 'fileId', need: 'image' });
      else if (b.type === 'file') out.push({ locale, blockIndex, fileId: b.fileId.toLowerCase(), field: 'fileId', need: 'any' });
      else if (b.type === 'text') {
        for (const r of markdownRefs(b.markdown)) out.push({ locale, blockIndex, field: 'markdown', ...r });
      }
    });
  }
  return out;
}

type FileSnapshot = {
  id: string;
  status: string;
  purpose: string;
  kind: FileKind;
  ext: FileExt;
  sizeBytes: number;
  originalName: string;
  width: number | null;
  height: number | null;
  courseId: string | null;
};

/**
 * Проверяет ссылки (файл active, lesson_material, этого курса, нужного вида) и переписывает
 * снимки из БД: значениям с клиента не верим. Строки files берутся FOR SHARE в порядке id:
 * подметание и удаление ждут завершения сохранения (и наоборот), взаимоблокировок нет.
 */
export async function resolveLessonFiles(
  sql: Sql,
  courseId: string,
  content: LessonContent,
): Promise<{ content: LessonContent; fileIds: string[] }> {
  const refs = collectFileRefs(content);
  if (refs.length === 0) return { content, fileIds: [] };

  const ids = [...new Set(refs.map((r) => r.fileId))].sort();
  const rows = await sql<FileSnapshot>`
    SELECT id, status, purpose, kind, ext, size_bytes, original_name, width, height, course_id
    FROM files WHERE id = ANY(${ids}) ORDER BY id FOR SHARE`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const issues: ContentIssue[] = [];
  for (const r of refs) {
    const f = byId.get(r.fileId);
    const path = [r.locale, 'blocks', r.blockIndex, r.field];
    const usable = f && f.status === 'active' && f.purpose === 'lesson_material' && f.courseId === courseId;
    if (!usable) {
      issues.push({ path, code: 'file_not_found', message: 'file_not_found' });
    } else if (r.need === 'image' && f.kind !== 'image') {
      issues.push({ path, code: 'file_wrong_kind', message: 'file_wrong_kind' });
    }
  }
  if (issues.length > 0) throw new AdminError('VALIDATION', { content: 'invalid' }, issues);

  const rewrite = (doc: LessonDoc | undefined): LessonDoc | undefined =>
    doc && {
      ...doc,
      blocks: doc.blocks.map((b): Block => {
        if (b.type === 'image') {
          const f = byId.get(b.fileId.toLowerCase()) as FileSnapshot;
          return { ...b, fileId: f.id, width: f.width ?? b.width, height: f.height ?? b.height };
        }
        if (b.type === 'file') {
          const f = byId.get(b.fileId.toLowerCase()) as FileSnapshot;
          return { ...b, fileId: f.id, name: f.originalName, ext: f.ext, sizeBytes: f.sizeBytes };
        }
        return b;
      }),
    };

  const ru = rewrite(content.ru) as LessonDoc;
  const kz = rewrite(content.kz);
  return { content: kz ? { ru, kz } : { ru }, fileIds: ids };
}

/** Заменяет набор lesson_files урока: убирает отсутствующие, добавляет новые. */
export async function syncLessonFiles(sql: Sql, lessonId: string, fileIds: readonly string[]): Promise<void> {
  const ids = [...fileIds];
  await sql`DELETE FROM lesson_files WHERE lesson_id = ${lessonId} AND NOT (file_id = ANY(${ids}::text[]))`;
  if (ids.length === 0) return;
  await sql`
    INSERT INTO lesson_files (lesson_id, file_id)
    SELECT ${lessonId}, x FROM unnest(${ids}::text[]) AS x
    ON CONFLICT DO NOTHING`;
}
