// Авторизация для страниц и server actions. Нормативно: docs/lms/BUILD.md §5.
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '../db';
import { safeNext } from './safeNext';
import { readSessionUser } from './session';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'author' | 'learner';
  locale: 'ru' | 'kz';
};

export type Membership = {
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: 'manager' | 'member';
  position: string | null;
};

/** Email в каноническом виде (так он хранится в users.email). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Текущий пользователь (кешируется на запрос) или null. */
export const getCurrentUser = cache(async (): Promise<User | null> => readSessionUser());

function loginPath(locale: string, nextPath?: string): string {
  const loc = locale === 'kz' ? 'kz' : 'ru';
  const next = nextPath ? safeNext(nextPath) : null;
  return next ? `/${loc}/login?next=${encodeURIComponent(next)}` : `/${loc}/login`;
}

/** Вошедший пользователь, иначе редирект на /{locale}/login?next=… */
export async function requireUser(locale: string, nextPath?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(locale, nextPath));
  return user;
}

/** Администратор; гостя — на вход, остальным — 404 (не раскрываем админку). */
export async function requireAdmin(locale: string, nextPath?: string): Promise<User> {
  const user = await requireUser(locale, nextPath);
  if (user.role !== 'admin') notFound();
  return user;
}

/** Организации пользователя с его ролью и должностью. */
export async function getMemberships(userId: string): Promise<Membership[]> {
  const db = await getDb();
  return db.sql<Membership>`
    SELECT m.org_id, o.slug AS org_slug, o.name AS org_name, m.role, m.position
    FROM organization_members m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ${userId}
    ORDER BY o.kind = 'owner' DESC, o.name`;
}

export async function isManagerOf(userId: string, orgId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.sql`
    SELECT 1 FROM organization_members WHERE user_id = ${userId} AND org_id = ${orgId} AND role = 'manager'`;
  return rows.length > 0;
}
