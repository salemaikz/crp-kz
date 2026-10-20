// Первый администратор и организация-владелец на чистой установке. Нормативно: docs/lms/design/ops.md §3.16.
// Вызывается из scripts/create-admin.ts. Журнал — общий writeAudit (actor_id NULL, meta без email и имён).
import { z } from 'zod';
import { newId, now, type Db } from '../db';
import { writeAudit } from '../audit';
import { hashPassword, passwordProblem } from '../auth/password';

/** Для администратора пароль строже, чем для слушателя (8 символов). */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export type CreateAdminInput = {
  email: string;
  name: string;
  locale: 'ru' | 'kz';
  /** Без пароля допустим только promote. */
  password?: string;
  promote: boolean;
  ownerOrg?: { name: string; slug: string };
};

export type CreateAdminResult = {
  userId: string;
  created: boolean;
  promoted: boolean;
  orgId: string | null;
  orgCreated: boolean;
};

export type CreateAdminErrorCode = 'validation' | 'weak_password' | 'exists' | 'not_found' | 'bad_slug' | 'unverified';

export class CreateAdminError extends Error {
  constructor(readonly code: CreateAdminErrorCode) {
    super(code);
    this.name = 'CreateAdminError';
  }
}

const emailSchema = z.string().max(254).email();
const nameSchema = z.string().min(1).max(100);
const SLUG_RE = /^[a-z0-9-]{2,40}$/;

/** Тот же вид, что normalizeEmail в src/lib/auth (users.email): модуль auth тянет next/*, скрипту он не нужен. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export async function createAdmin(db: Db, input: CreateAdminInput): Promise<CreateAdminResult> {
  const email = normalize(input.email);
  if (!emailSchema.safeParse(email).success) throw new CreateAdminError('validation');
  const name = nameSchema.safeParse(input.name.trim());
  if (!name.success) throw new CreateAdminError('validation');
  if (input.locale !== 'ru' && input.locale !== 'kz') throw new CreateAdminError('validation');

  let ownerOrg: { name: string; slug: string } | undefined;
  if (input.ownerOrg) {
    const orgName = input.ownerOrg.name.trim();
    if (!orgName || orgName.length > 200) throw new CreateAdminError('validation');
    if (!SLUG_RE.test(input.ownerOrg.slug)) throw new CreateAdminError('bad_slug');
    ownerOrg = { name: orgName, slug: input.ownerOrg.slug };
  }

  let passwordHash: string | null = null;
  if (input.password !== undefined && !input.promote) {
    const problem = passwordProblem(input.password);
    if (problem) throw new CreateAdminError(problem);
    if (input.password.length < ADMIN_PASSWORD_MIN_LENGTH) throw new CreateAdminError('weak_password');
    passwordHash = await hashPassword(input.password);
  } else if (!input.promote) {
    throw new CreateAdminError('validation');
  }

  return db.tx(async (sql) => {
    const t = now();
    let userId: string;
    let created = false;
    let promoted = false;

    // --promote не создаёт пользователей: только повышает существующих
    const [ins] = passwordHash && !input.promote
      ? await sql<{ id: string }>`
          INSERT INTO users (id, email, password_hash, name, role, locale, email_verified_at, created_at)
          VALUES (${newId()}, ${email}, ${passwordHash}, ${name.data}, 'admin', ${input.locale}, ${t}, ${t})
          ON CONFLICT (email) DO NOTHING
          RETURNING id`
      : [];
    if (ins) {
      userId = ins.id;
      created = true;
      await writeAudit(sql, { actorId: null, action: 'user.create_admin', entity: 'user', entityId: userId, meta: { via: 'cli' } });
    } else {
      const [existing] = await sql<{ id: string; role: string; emailVerifiedAt: number | null }>`SELECT id, role, email_verified_at AS "emailVerifiedAt" FROM users WHERE email = ${email} FOR UPDATE`;
      if (!existing) throw new CreateAdminError(input.promote ? 'not_found' : 'validation');
      if (!input.promote) throw new CreateAdminError('exists');
      // Регистрация открыта: аккаунт с неподтверждённым адресом мог завести кто угодно, повышать его вслепую нельзя
      if (existing.role !== 'admin' && existing.emailVerifiedAt == null) throw new CreateAdminError('unverified');
      userId = existing.id;
      // Пароль, имя и сессии существующего пользователя не трогаем: меняется только роль
      if (existing.role !== 'admin') {
        await sql`UPDATE users SET role = 'admin' WHERE id = ${userId}`;
        promoted = true;
        await writeAudit(sql, {
          actorId: null,
          action: 'user.role_change',
          entity: 'user',
          entityId: userId,
          meta: { to: 'admin', via: 'cli' },
        });
      }
    }

    let orgId: string | null = null;
    let orgCreated = false;
    if (ownerOrg) {
      const [owner] = await sql<{ id: string }>`SELECT id FROM organizations WHERE kind = 'owner' ORDER BY created_at LIMIT 1`;
      if (owner) {
        orgId = owner.id;
      } else {
        const [row] = await sql<{ id: string }>`
          INSERT INTO organizations (id, slug, name, kind, created_at)
          VALUES (${newId()}, ${ownerOrg.slug}, ${ownerOrg.name}, 'owner', ${t})
          ON CONFLICT (slug) DO NOTHING
          RETURNING id`;
        // slug уже занят организацией-клиентом: владельца под этим slug не создаём
        if (!row) throw new CreateAdminError('bad_slug');
        orgId = row.id;
        orgCreated = true;
        await writeAudit(sql, { actorId: null, action: 'org.create', entity: 'org', entityId: orgId, meta: { via: 'cli', kind: 'owner' } });
      }
      const [member] = await sql<{ userId: string }>`
        INSERT INTO organization_members (org_id, user_id, role, created_at)
        VALUES (${orgId}, ${userId}, 'manager', ${t})
        ON CONFLICT (org_id, user_id) DO NOTHING
        RETURNING user_id`;
      if (member) {
        await writeAudit(sql, {
          actorId: null,
          action: 'org.member_add',
          entity: 'org',
          entityId: orgId,
          meta: { userId, role: 'manager', via: 'cli' },
        });
      }
    }

    return { userId, created, promoted, orgId, orgCreated };
  });
}
