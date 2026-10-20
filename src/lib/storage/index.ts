// Точка входа хранилища: провайдер по настройкам окружения.
import { storageConfig } from './config';
import { createLocalStorage } from './local';
import { StorageUnavailableError, type StorageProvider } from './types';

export { assertStorageKey, newStorageKey } from './keys';
export { StorageUnavailableError } from './types';
export type { StorageKey, StorageObject, StorageProvider } from './types';

const cache = new Map<string, StorageProvider>();

/** Провайдер для текущего окружения; бросает StorageUnavailableError, если хранилище не настроено. */
export function getStorage(): StorageProvider {
  const cfg = storageConfig();
  if (!cfg.ok) throw new StorageUnavailableError(cfg.reason);
  let provider = cache.get(cfg.root);
  if (!provider) {
    provider = createLocalStorage(cfg.root);
    cache.set(cfg.root, provider);
  }
  return provider;
}
