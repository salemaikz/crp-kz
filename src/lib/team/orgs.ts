// Организации руководителя и их сотрудники. Изоляция: всё читается строго по orgId.
import { getDb } from '../db';
import type { ManagedOrg, TeamMember } from './types';

/** Организации, где пользователь — руководитель (role = manager). Свой ЦРП — первым. */
export async function getManagedOrgs(userId: string): Promise<ManagedOrg[]> {
  const db = await getDb();
  return db.sql<ManagedOrg>`
    SELECT o.id AS org_id, o.slug, o.name, o.kind
    FROM organization_members m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ${userId} AND m.role = 'manager'
    ORDER BY (o.kind = 'owner') DESC, o.name, o.id`;
}

/** Короткое название организации для заголовков: свой ЦРП — «ЦРП», остальные — как названы. */
export function orgLabel(org: Pick<ManagedOrg, 'kind' | 'name'>): string {
  return org.kind === 'owner' ? 'ЦРП' : org.name;
}

/** Выбор организации по ?org= (slug); неизвестное значение — первая из доступных. */
export function pickOrg(orgs: readonly ManagedOrg[], slug: unknown): ManagedOrg | null {
  const v = Array.isArray(slug) ? slug[0] : slug;
  return orgs.find((o) => o.slug === v) ?? orgs[0] ?? null;
}

/** Сотрудники организации (все роли), по алфавиту. */
export async function listMembers(orgId: string): Promise<TeamMember[]> {
  const db = await getDb();
  return db.sql<TeamMember>`
    SELECT u.id AS user_id, u.name, u.email, m.position, m.role
    FROM organization_members m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${orgId}
    ORDER BY lower(u.name), u.id`;
}
