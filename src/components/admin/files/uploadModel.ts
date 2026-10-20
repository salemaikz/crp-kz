// Модель интерфейса загрузки: что можно выбрать, предпроверка, разбор ответа сервера, вставка в текст.
// Чистые функции без React и браузерных API: проверяются юнит-тестами. Сервер остаётся главным —
// он определяет тип по содержимому, а предпроверка только не гоняет по сети заведомо лишнее.
import type { StoredFile, UploadErrorCode, UploadPurpose } from '@/lib/files/types';
import { FILE_TYPES, PURPOSE_TYPES, type FileExt } from '@/lib/storage/limits';

/** Что загружает кнопка: картинку в блок или в текст, файл в блок, обложку курса. */
export type UploadKind = 'image' | 'file' | 'cover';

export type UploadLimits = { image: number; document: number };

/** Настройки загрузки для редактора урока: всё считает страница на сервере (флаг, хранилище, лимиты, демо). */
export type LessonUploads = {
  /** UPLOADS активен: без него кнопок загрузки нет, существующие блоки показываются без превью. */
  enabled: boolean;
  /** Хранилище настроено; иначе вместо кнопок — errors.storage_unavailable. */
  storageOk: boolean;
  courseId: string;
  lessonId: string;
  limits: UploadLimits;
  /** Публичное демо: рядом с кнопками предупреждение о персональных данных. */
  demo: boolean;
};

export const EXT_LABEL: Record<FileExt, string> = { png: 'PNG', jpg: 'JPEG', webp: 'WebP', pdf: 'PDF', docx: 'DOCX', xlsx: 'XLSX' };

const IMAGE_EXTS: readonly FileExt[] = ['png', 'jpg', 'webp'];

export function purposeOf(kind: UploadKind): UploadPurpose {
  return kind === 'cover' ? 'course_cover' : 'lesson_material';
}

/** Допустимые расширения: картинка и обложка — PNG, JPEG, WebP; файл — всё, что принимает урок. */
export function extsFor(kind: UploadKind): readonly FileExt[] {
  return kind === 'file' ? PURPOSE_TYPES.lesson_material : IMAGE_EXTS;
}

/** Значение accept для input: расширения и MIME. Подсказка проводнику, не защита. */
export function acceptFor(kind: UploadKind): string {
  const exts = extsFor(kind);
  const names = exts.map((e) => `.${e}`);
  if (exts.includes('jpg')) names.push('.jpeg');
  return [...names, ...exts.map((e) => FILE_TYPES[e].mime)].join(',');
}

/** «PDF, DOCX, XLSX, PNG, JPEG, WebP» — для подстановки {types} в errors.bad_type. */
export function typesLabel(kind: UploadKind): string {
  return extsFor(kind)
    .map((e) => EXT_LABEL[e])
    .join(', ');
}

/** Расширение из имени в нижнем регистре, без точки; '' если его нет. */
export function nameExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Предел размера для выбранного файла: картинки по предельному размеру картинки, остальное — документа. */
export function limitFor(kind: UploadKind, name: string, limits: UploadLimits): number {
  if (kind !== 'file') return limits.image;
  const ext = nameExt(name);
  return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' ? limits.image : limits.document;
}

export type UploadErrorView = { code: UploadErrorCode | 'generic'; params?: Record<string, string | number> };

/** Картинка и обложка принимают только изображения; документ по расширению отсекаем до отправки. */
export function wrongKindByName(name: string, kind: UploadKind): boolean {
  if (kind === 'file') return false;
  const ext = nameExt(name);
  if (ext === 'jpeg') return false;
  return ext in FILE_TYPES && !IMAGE_EXTS.includes(ext as FileExt);
}

/** Сервер определяет тип по содержимому: для картинки и обложки в ответе должно быть изображение. */
export function isWrongKind(kind: UploadKind, file: { kind: string }): boolean {
  return kind !== 'file' && file.kind !== 'image';
}

/** Предпроверка до отправки: пустой файл, не тот тип по расширению и размер выше предела. null — отправлять. */
export function precheck(file: { name: string; size: number }, kind: UploadKind, limits: UploadLimits): UploadErrorView | null {
  if (file.size === 0) return { code: 'empty' };
  if (wrongKindByName(file.name, kind)) return { code: 'bad_type' };
  const max = limitFor(kind, file.name, limits);
  if (file.size > max) return { code: 'too_large', params: { max } };
  return null;
}

const ERROR_CODES: readonly UploadErrorCode[] = [
  'disabled',
  'forbidden',
  'not_found',
  'bad_request',
  'cross_site',
  'length_required',
  'too_large',
  'empty',
  'bad_type',
  'macro',
  'image_too_large',
  'image_too_small',
  'quota',
  'rate_limited',
  'busy',
  'storage_unavailable',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isStoredFile(v: unknown): v is StoredFile {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.url === 'string' &&
    typeof v.name === 'string' &&
    typeof v.ext === 'string' &&
    v.ext in FILE_TYPES &&
    typeof v.sizeBytes === 'number'
  );
}

/** Ответ POST /api/uploads → файл или код ошибки. Всё непонятное (413 площадки без JSON, HTML-страница) — generic. */
export function parseUploadResponse(status: number, body: unknown): { ok: true; file: StoredFile } | ({ ok: false } & UploadErrorView) {
  if (isRecord(body) && body.ok === true && status === 201 && isStoredFile(body.file)) return { ok: true, file: body.file };
  if (isRecord(body) && body.ok === false && typeof body.error === 'string' && (ERROR_CODES as readonly string[]).includes(body.error)) {
    const params: Record<string, string | number> = {};
    if (isRecord(body.params)) {
      for (const [k, v] of Object.entries(body.params)) if (typeof v === 'string' || typeof v === 'number') params[k] = v;
    }
    return { ok: false, code: body.error as UploadErrorCode, ...(Object.keys(params).length > 0 ? { params } : {}) };
  }
  return { ok: false, code: 'generic' };
}

/** Вставка в текст по положению курсора: заменяет выделение, возвращает новое значение и позицию каретки. */
export function insertAtCursor(value: string, start: number, end: number, insert: string): { value: string; caret: number } {
  const a = Math.max(0, Math.min(start, value.length));
  const b = Math.max(a, Math.min(end, value.length));
  return { value: value.slice(0, a) + insert + value.slice(b), caret: a + insert.length };
}
