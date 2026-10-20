// Классификация OOXML по центральному каталогу ZIP и [Content_Types].xml.
import type { ZipEntry } from './zip';

/**
 * 'macro' — файл с макросами или ActiveX (отказ); null — не DOCX и не XLSX
 * (ZIP без нужных частей, а также архив, похожий сразу на оба формата).
 */
export function classifyOoxml(centralDir: ZipEntry[], contentTypesXml: string): 'docx' | 'xlsx' | 'macro' | null {
  const names = new Set(centralDir.map((e) => e.name));
  const macro =
    centralDir.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name) || /(^|\/)activeX\//i.test(e.name)) ||
    /macroEnabled/i.test(contentTypesXml);
  if (macro) return 'macro';
  const docx = names.has('word/document.xml') && contentTypesXml.includes('wordprocessingml.document.main+xml');
  const xlsx = names.has('xl/workbook.xml') && contentTypesXml.includes('spreadsheetml.sheet.main+xml');
  if (docx === xlsx) return null;
  return docx ? 'docx' : 'xlsx';
}
