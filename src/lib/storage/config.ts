// Настройки хранилища из окружения (D-034). Fail closed: без корректного STORAGE_DIR вне демо
// загрузка недоступна, временный каталог не подставляется.
import os from 'node:os';
import path from 'node:path';
import { isDemo, type Env } from '../env';
import { UPLOAD_LIMITS, type FileKind } from './limits';

export type StorageConfig =
  | { ok: true; provider: 'local'; root: string; demo: boolean; serverless: boolean }
  | { ok: false; reason: 'not_configured' | 'relative_path' | 'inside_app_dir' | 'provider_not_implemented' };

const isServerless = (env: Env): boolean => env.VERCEL === '1' || env.NETLIFY === 'true';

export function storageConfig(env: Env = process.env): StorageConfig {
  const provider = env.STORAGE_PROVIDER?.trim() || 'local';
  if (provider !== 'local') return { ok: false, reason: 'provider_not_implemented' };

  const demo = isDemo(env);
  let root = env.STORAGE_DIR?.trim();
  if (!root) {
    if (!demo) return { ok: false, reason: 'not_configured' };
    root = path.join(os.tmpdir(), 'crp-demo-files');
  }
  if (!path.isAbsolute(root)) return { ok: false, reason: 'relative_path' };
  root = path.resolve(root);
  // Каталог релиза пересоздаётся при каждой выкладке (D-027), а public/ раздаётся без проверки доступа.
  if (!demo) {
    const app = process.cwd();
    if (root === app || root.startsWith(app + path.sep)) return { ok: false, reason: 'inside_app_dir' };
  }
  return { ok: true, provider: 'local', root, demo, serverless: isServerless(env) };
}

/** Эффективный предел размера для вида файла с учётом демо на serverless (лимит тела площадки). */
export function maxBytesFor(kind: FileKind, env: Env = process.env): number {
  const base = kind === 'image' ? UPLOAD_LIMITS.imageBytes : UPLOAD_LIMITS.documentBytes;
  return isDemo(env) && isServerless(env) ? Math.min(base, UPLOAD_LIMITS.serverlessDemoBytes) : base;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const v = raw?.trim();
  if (!v || !/^\d{1,15}$/.test(v)) return fallback;
  const n = Number(v);
  return n > 0 ? n : fallback;
}

/** Квоты в байтах: на все файлы и на один курс (UPLOAD_QUOTA_BYTES, UPLOAD_COURSE_QUOTA_BYTES). */
export function quotaConfig(env: Env = process.env): { total: number; course: number } {
  return {
    total: positiveInt(env.UPLOAD_QUOTA_BYTES, UPLOAD_LIMITS.totalQuotaBytesDefault),
    course: positiveInt(env.UPLOAD_COURSE_QUOTA_BYTES, UPLOAD_LIMITS.courseQuotaBytesDefault),
  };
}
