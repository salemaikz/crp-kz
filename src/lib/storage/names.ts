// Имена файлов: очистка имени для показа и безопасный заголовок Content-Disposition.
import { UPLOAD_LIMITS, type FileExt, type FileKind } from './limits';

// Управляющие символы (включая C1) и символы направления текста (RTLO и родственники).
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const FORBIDDEN = /[<>:"/\\|?*]/g;
const EDGE = /^[\s.]+|[\s.]+$/g;

/**
 * Имя для показа. Путь отбрасывается, расширение ЗАМЕНЯЕТСЯ каноническим из сигнатуры:
 * «Отчёт.PDF.exe» с содержимым PDF → «Отчёт.PDF.pdf». Пустое имя → «file.<ext>».
 */
export function sanitizeFileName(raw: string, ext: FileExt): string {
  const last = raw.split(/[\\/]/).pop() ?? '';
  let base = last.normalize('NFC').replace(CONTROL, '').replace(BIDI, '').replace(FORBIDDEN, '');
  // прежнее расширение (до 5 латинских букв и цифр) снимаем до обрезки краёв: «  .pdf» — это пустое имя
  base = base.replace(/\s+/g, ' ').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(EDGE, '');
  base = Array.from(base).slice(0, UPLOAD_LIMITS.nameMax).join('').replace(EDGE, '');
  return base ? `${base}.${ext}` : `file.${ext}`;
}

/** attachment для документов, inline для изображений; имя — ASCII-запасное и RFC 5987. */
export function contentDisposition(kind: FileKind, name: string): string {
  const type = kind === 'image' ? 'inline' : 'attachment';
  const clean = name.replace(CONTROL, '').replace(BIDI, '');
  const ascii = clean.replace(/[^\x20-\x7E]|["\\%]/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
