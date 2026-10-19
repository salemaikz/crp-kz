// Сид: организация ЦРП, демо-аккаунты и сотрудники. Все имена и email вымышленные.
import { DEMO_ACCOUNTS, type DemoRole } from '../../auth/demo';
import { seedId } from '../../content/ids';
import type { Sql } from '../core';
import { DAY } from './time';

export const SEED_ORG = { slug: 'crp', name: 'ЦРП — Центр Развития Предпринимателей', kind: 'owner' } as const;
export const seedOrgId = (): string => seedId('org', SEED_ORG.slug);
export const seedUserId = (email: string): string => seedId('user', email);

export type SeedPerson = {
  email: string;
  name: string;
  role: 'admin' | 'author' | 'learner';
  /** Членство в ЦРП: null — не сотрудник. */
  member: { role: 'manager' | 'member'; position: string } | null;
  /** Назначение внутреннего курса: срок (дни от базы) и доля пройденных уроков. */
  assignment?: { dueInDays: number; progress: number };
};

const DEMO_EXTRA: Record<DemoRole, Pick<SeedPerson, 'role' | 'member' | 'assignment'>> = {
  admin: { role: 'admin', member: null },
  manager: { role: 'learner', member: { role: 'manager', position: 'Руководитель отдела продаж' } },
  operator: {
    role: 'learner',
    member: { role: 'member', position: 'Оператор колл-центра' },
    assignment: { dueInDays: 5, progress: 0.4 },
  },
  client: { role: 'learner', member: null },
};

/** Ещё 5 сотрудников ЦРП с разным прогрессом — для отчёта руководителя. */
const EMPLOYEES: SeedPerson[] = [
  {
    email: 'asel.karimova@crp.demo',
    name: 'Асель Каримова',
    role: 'learner',
    member: { role: 'member', position: 'Оператор колл-центра' },
    assignment: { dueInDays: -3, progress: 0.25 },
  },
  {
    email: 'dmitriy.kim@crp.demo',
    name: 'Дмитрий Ким',
    role: 'learner',
    member: { role: 'member', position: 'Оператор колл-центра' },
    assignment: { dueInDays: 10, progress: 1 },
  },
  {
    email: 'zhanar.tuleuova@crp.demo',
    name: 'Жанар Тулеуова',
    role: 'learner',
    member: { role: 'member', position: 'Консультант' },
    assignment: { dueInDays: 2, progress: 0 },
  },
  {
    email: 'arman.bekenov@crp.demo',
    name: 'Арман Бекенов',
    role: 'learner',
    member: { role: 'member', position: 'Оператор колл-центра' },
    assignment: { dueInDays: -7, progress: 0.6 },
  },
  {
    email: 'olga.pavlova@crp.demo',
    name: 'Ольга Павлова',
    role: 'learner',
    member: { role: 'member', position: 'Менеджер по работе с клиентами' },
    assignment: { dueInDays: 14, progress: 0.8 },
  },
];

export const SEED_PEOPLE: SeedPerson[] = [
  ...DEMO_ACCOUNTS.map((a) => ({ email: a.email, name: a.name, ...DEMO_EXTRA[a.role] })),
  ...EMPLOYEES,
];

export const demoEmail = (role: DemoRole): string => DEMO_ACCOUNTS.find((a) => a.role === role)?.email as string;

/** Организация, пользователи (один хеш пароля на всех) и членства. */
export async function seedPeople(sql: Sql, base: number, passwordHash: string): Promise<void> {
  const orgId = seedOrgId();
  await sql`
    INSERT INTO organizations (id, slug, name, kind, created_at)
    VALUES (${orgId}, ${SEED_ORG.slug}, ${SEED_ORG.name}, ${SEED_ORG.kind}, ${base - 120 * DAY})
    ON CONFLICT (id) DO NOTHING`;
  for (const [i, p] of SEED_PEOPLE.entries()) {
    const id = seedUserId(p.email);
    const createdAt = base - (p.member ? 90 : 40) * DAY + i * 60_000;
    await sql`
      INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
      VALUES (${id}, ${p.email}, ${passwordHash}, ${p.name}, ${p.role}, 'ru', ${createdAt})
      ON CONFLICT (id) DO NOTHING`;
    if (p.member) {
      await sql`
        INSERT INTO organization_members (org_id, user_id, role, position, created_at)
        VALUES (${orgId}, ${id}, ${p.member.role}, ${p.member.position}, ${createdAt})
        ON CONFLICT (org_id, user_id) DO NOTHING`;
    }
  }
}
