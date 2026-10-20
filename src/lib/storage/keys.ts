// Ключи объектов хранилища: генерирует только сервер, проверяет регулярным выражением.
import { randomUUID } from 'node:crypto';
import type { StorageKey } from './types';

const KEY_RE = /^([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** `${uuid.slice(0,2)}/${uuid}` — имя пользователя в ключ не попадает. */
export function newStorageKey(): StorageKey {
  const id = randomUUID();
  return `${id.slice(0, 2)}/${id}`;
}

/** Бросает Error для всего, что не является ключом нашего вида (обход каталогов, NUL, регистр). */
export function assertStorageKey(key: string): StorageKey {
  const m = typeof key === 'string' ? KEY_RE.exec(key) : null;
  if (!m || !(m[2] as string).startsWith(m[1] as string)) throw new Error('storage: недопустимый ключ');
  return key;
}
