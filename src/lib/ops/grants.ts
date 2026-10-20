// Выдача прав роли приложения: выполняет deploy/postgres/grants.sql (D-026, ops.md §3.13).
// Тот же приём, что у миграций: exec только для файла из репозитория, имена ролей — параметрами сессии.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DbHandle } from '../db';

export const ROLE_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
export const DEFAULT_APP_ROLE = 'crp_app';
export const DEFAULT_OWNER_ROLE = 'crp_owner';

export function grantsFile(): string {
  return path.join(process.cwd(), 'deploy', 'postgres', 'grants.sql');
}

/** Имена ролей из окружения или значения по умолчанию; неверное имя — ошибка до обращения к БД. */
export function grantRoles(env: Record<string, string | undefined> = process.env): { app: string; owner: string } {
  const app = env.DB_APP_ROLE?.trim() || DEFAULT_APP_ROLE;
  const owner = env.DB_OWNER_ROLE?.trim() || DEFAULT_OWNER_ROLE;
  if (!ROLE_NAME_RE.test(app) || !ROLE_NAME_RE.test(owner)) {
    throw new Error('DB_APP_ROLE и DB_OWNER_ROLE: строчные латинские буквы, цифры и «_», не длиннее 63 символов.');
  }
  return { app, owner };
}

/** В одной транзакции: роли — параметрами сессии, затем grants.sql. Только Postgres. */
export async function applyGrants(db: DbHandle, roles: { app: string; owner: string }, file = grantsFile()): Promise<void> {
  if (!ROLE_NAME_RE.test(roles.app) || !ROLE_NAME_RE.test(roles.owner)) throw new Error('Недопустимое имя роли.');
  const script = await readFile(file, 'utf8');
  await db.withTx(async (c) => {
    await c.sql`SELECT set_config('crp.app_role', ${roles.app}, true), set_config('crp.owner_role', ${roles.owner}, true)`;
    await c.exec(script);
  });
}
