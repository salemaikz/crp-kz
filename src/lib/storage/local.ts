// Провайдер local: файлы в каталоге на сервере ЦРП. Объект — objects/<ab>/<uuid>, режим 0600,
// без расширения; создаётся атомарным rename из .tmp на том же томе.
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, readdir, rename, statfs, unlink, access, constants } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { assertStorageKey } from './keys';
import type { StorageKey, StorageObject, StorageProvider } from './types';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';
}

export function createLocalStorage(root: string): StorageProvider {
  const objectsDir = path.join(root, 'objects');
  const tmpDir = path.join(root, '.tmp');

  async function ensureDirs(): Promise<void> {
    await mkdir(objectsDir, { recursive: true, mode: DIR_MODE });
    await mkdir(tmpDir, { recursive: true, mode: DIR_MODE });
  }

  /** Путь объекта: ключ проверен регулярным выражением, итог обязан лежать внутри objects/. */
  function objectPath(key: StorageKey): string {
    const p = path.resolve(objectsDir, assertStorageKey(key));
    if (!p.startsWith(objectsDir + path.sep)) throw new Error('storage: путь вне хранилища');
    return p;
  }

  return {
    name: 'local',

    async health() {
      try {
        await ensureDirs();
        const [rootStat, objectsStat, tmpStat] = await Promise.all([lstat(root), lstat(objectsDir), lstat(tmpDir)]);
        if (!rootStat.isDirectory() && !rootStat.isSymbolicLink()) return { ok: false, freeBytes: null, reason: 'not_directory' };
        if (objectsStat.isSymbolicLink() || tmpStat.isSymbolicLink()) return { ok: false, freeBytes: null, reason: 'symlink' };
        await access(root, constants.W_OK);
        let freeBytes: number | null = null;
        try {
          const s = await statfs(root);
          freeBytes = Number(s.bavail) * Number(s.bsize);
        } catch {
          freeBytes = null; // платформа без statfs: порог места не проверяем
        }
        return { ok: true, freeBytes };
      } catch {
        return { ok: false, freeBytes: null, reason: 'not_writable' };
      }
    },

    async tempDir() {
      await ensureDirs();
      return tmpDir;
    },

    async putFromTemp(key, tmpPath) {
      const target = objectPath(key);
      if (!path.resolve(tmpPath).startsWith(tmpDir + path.sep)) throw new Error('storage: временный файл вне .tmp');
      await mkdir(path.dirname(target), { recursive: true, mode: DIR_MODE });
      await chmod(tmpPath, FILE_MODE);
      await rename(tmpPath, target);
    },

    async open(key): Promise<StorageObject | null> {
      const p = objectPath(key);
      try {
        const st = await lstat(p);
        if (!st.isFile()) return null; // симлинки и каталоги не отдаём
        return { body: Readable.toWeb(createReadStream(p)) as unknown as ReadableStream<Uint8Array>, size: st.size };
      } catch (e) {
        if (isEnoent(e)) return null;
        throw e;
      }
    },

    async remove(key) {
      try {
        await unlink(objectPath(key));
      } catch (e) {
        if (!isEnoent(e)) throw e;
      }
    },

    async *list(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      let prefixes: string[];
      try {
        prefixes = await readdir(objectsDir);
      } catch (e) {
        if (isEnoent(e)) return;
        throw e;
      }
      for (const prefix of prefixes) {
        if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
        for (const name of await readdir(path.join(objectsDir, prefix))) {
          const key = `${prefix}/${name}`;
          let ok = true;
          try {
            assertStorageKey(key);
          } catch {
            ok = false;
          }
          if (!ok) continue;
          const st = await lstat(path.join(objectsDir, prefix, name));
          if (st.isFile() && st.mtimeMs < cutoff) yield { key, mtimeMs: st.mtimeMs };
        }
      }
    },

    async removeStaleTemp(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      let removed = 0;
      let names: string[];
      try {
        names = await readdir(tmpDir);
      } catch (e) {
        if (isEnoent(e)) return 0;
        throw e;
      }
      for (const name of names) {
        const p = path.join(tmpDir, name);
        try {
          const st = await lstat(p);
          if (st.isFile() && st.mtimeMs < cutoff) {
            await unlink(p);
            removed++;
          }
        } catch (e) {
          if (!isEnoent(e)) throw e;
        }
      }
      return removed;
    },
  };
}
