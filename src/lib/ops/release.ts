// Сведения о релизе для /api/health и выкладки. Нормативно: docs/lms/design/ops.md §3.14.
// RELEASE.json лежит в корне каталога релиза (его пишет deploy.sh); на Vercel и Netlify — запасной
// вариант из переменных платформы; в разработке — id «dev».
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Env } from '../env';

export type ReleaseInfo = { id: string; tag: string | null; sha: string | null; builtAt: number | null };

const SHA_RE = /^[0-9a-f]{7,40}$/;

const releaseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  tag: z.string().max(100).nullish(),
  sha: z.string().regex(SHA_RE).nullish(),
  builtAt: z.number().int().nonnegative().nullish(),
});

/** Разбор содержимого RELEASE.json: лишние поля игнорируются, неверная форма — null. */
export function parseRelease(json: unknown): ReleaseInfo | null {
  const r = releaseSchema.safeParse(json);
  if (!r.success) return null;
  return { id: r.data.id, tag: r.data.tag ?? null, sha: r.data.sha ?? null, builtAt: r.data.builtAt ?? null };
}

function fromPlatform(env: Env): ReleaseInfo | null {
  const sha = (env.VERCEL_GIT_COMMIT_SHA ?? env.COMMIT_REF)?.trim().toLowerCase();
  if (!sha || !SHA_RE.test(sha)) return null;
  return { id: sha.slice(0, 12), tag: null, sha, builtAt: null };
}

/** Без кэша: RELEASE.json из cwd, затем переменные платформы, затем 'dev'. */
export function loadRelease(cwd: string = process.cwd(), env: Env = process.env): ReleaseInfo {
  try {
    const parsed = parseRelease(JSON.parse(readFileSync(path.join(cwd, 'RELEASE.json'), 'utf8')));
    if (parsed) return parsed;
  } catch {
    // нет файла или не JSON — запасные варианты
  }
  return fromPlatform(env) ?? { id: 'dev', tag: null, sha: null, builtAt: null };
}

let cached: ReleaseInfo | null = null;

/**
 * Релиз текущего процесса: читается один раз (код релиза не меняется под работающим процессом).
 * С явными cwd или env — без кэша (тесты).
 */
export function readRelease(cwd?: string, env?: Env): ReleaseInfo {
  if (cwd !== undefined || env !== undefined) return loadRelease(cwd, env);
  cached ??= loadRelease();
  return cached;
}
