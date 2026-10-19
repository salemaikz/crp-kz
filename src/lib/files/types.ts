// Типы домена файлов (D-034). Без серверных импортов: файл используют и клиентские компоненты.
import type { FileExt, FileKind } from '../storage/limits';

export type UploadPurpose = 'lesson_material' | 'course_cover';

export type FileRow = {
  id: string;
  storage: 'local' | 's3';
  storageKey: string;
  /** 'submission' — резерв под практические задания (#21), код пока его не создаёт. */
  purpose: UploadPurpose | 'submission';
  kind: FileKind;
  mime: string;
  ext: FileExt;
  sizeBytes: number;
  sha256: string;
  originalName: string;
  width: number | null;
  height: number | null;
  courseId: string | null;
  lessonId: string | null;
  uploadedBy: string | null;
  status: 'active' | 'deleted';
  createdAt: number;
  deletedAt: number | null;
};

/** Файл так, как его получает интерфейс после загрузки. */
export type StoredFile = {
  id: string;
  url: string;
  name: string;
  kind: FileKind;
  ext: FileExt;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

export type UploadErrorCode =
  | 'disabled'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'cross_site'
  | 'length_required'
  | 'too_large'
  | 'empty'
  | 'bad_type'
  | 'macro'
  | 'image_too_large'
  | 'image_too_small'
  | 'quota'
  | 'rate_limited'
  | 'busy'
  | 'storage_unavailable';

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    readonly status: number,
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
    this.name = 'UploadError';
  }
}
