// Интерфейс хранилища файлов (D-034). Провайдер local — каталог на сервере ЦРП; s3 — после решения ЦРП.

/** '<2 hex>/<uuid v4>': только из newStorageKey(), имя пользователя в ключ не попадает. */
export type StorageKey = string;

export type StorageObject = { body: ReadableStream<Uint8Array>; size: number };

export interface StorageProvider {
  readonly name: 'local' | 's3';
  /** Готовность: корень существует и доступен на запись; свободное место (если известно). */
  health(): Promise<{ ok: boolean; freeBytes: number | null; reason?: string }>;
  /** Каталог для временных файлов загрузки (на том же томе, что объекты: rename атомарен). */
  tempDir(): Promise<string>;
  /** Перенести готовый временный файл в хранилище под новым ключом. */
  putFromTemp(key: StorageKey, tmpPath: string): Promise<void>;
  /** Поток объекта или null, если объекта нет. */
  open(key: StorageKey): Promise<StorageObject | null>;
  /** Удалить объект; отсутствие объекта — не ошибка. */
  remove(key: StorageKey): Promise<void>;
  /** Объекты старше olderThanMs (по mtime) — для подметания «бесхозных» объектов. */
  list(olderThanMs: number): AsyncIterable<{ key: StorageKey; mtimeMs: number }>;
  /** Удалить временные файлы старше olderThanMs; возвращает их число. */
  removeStaleTemp(olderThanMs: number): Promise<number>;
}

/** Хранилище не настроено или не готово (fail closed). */
export class StorageUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`storage_unavailable: ${reason}`);
    this.name = 'StorageUnavailableError';
  }
}
