'use server';
// Server actions входа, регистрации и выхода. Нормативно: docs/lms/BUILD.md §5.
// Ошибки входа одинаковы для «нет такого email» и «неверный пароль» (нет перечисления пользователей).
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb, newId, now } from '../db';
import { writeAudit } from '../audit';
import { isDemo } from '../env';
import { isDemoAccountEmail } from './demo';
import { normalizeEmail } from './index';
import { hashPassword, passwordProblem, verifyPassword } from './password';
import { deriveClientIp, UNKNOWN_IP } from './clientIp';
import { AUTH_LIMITS, rateLimit, resetRateLimit } from './rateLimit';
import { safeNext } from './safeNext';
import { endSession, startSession } from './session';

export type AuthFormState =
  | {
      error?: 'invalid' | 'rate_limited' | 'exists' | 'weak_password' | 'validation' | 'consent';
      values?: { email?: string; name?: string };
    }
  | undefined;

/** Версия текста согласия на обработку ПДн. */
const PD_CONSENT_VERSION = '2026-10-19';

const emailSchema = z.string().max(254).email();
const nameSchema = z.string().trim().min(1).max(100);

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === 'string' ? v : '';
}

function localeOf(fd: FormData): 'ru' | 'kz' {
  return field(fd, 'locale') === 'kz' ? 'kz' : 'ru';
}

/** IP клиента по доверенной схеме (TRUSTED_PROXY_HOPS / TRUST_X_REAL_IP), иначе 'unknown'. */
async function clientIp(): Promise<string> {
  return deriveClientIp(await headers());
}

function allowed(...checks: Array<[string, { limit: number; windowMs: number }]>): boolean {
  return checks.every(([key, l]) => rateLimit(key, l.limit, l.windowMs).ok);
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const locale = localeOf(formData);
  const email = normalizeEmail(field(formData, 'email')).slice(0, 254);
  const password = field(formData, 'password');
  const values = { email };
  if (!email || !password) return { error: 'validation', values };
  if (password.length > 1024) return { error: 'invalid', values };

  const ip = await clientIp();
  const pairKey = `login:${ip}:${email}`;
  const emailKey = `login-email:${email}`;
  if (
    !allowed(
      // IP неизвестен — общее ведро на всех (щедрее): бережёт CPU, аккаунты защищает лимит на email
      ip === UNKNOWN_IP ? [`login:${UNKNOWN_IP}`, AUTH_LIMITS.loginUnknownIp] : [`login:${ip}`, AUTH_LIMITS.loginPerIp],
      [emailKey, AUTH_LIMITS.loginPerEmail],
      [pairKey, AUTH_LIMITS.loginPerIpEmail],
    )
  ) {
    return { error: 'rate_limited', values };
  }

  const db = await getDb();
  const [user] = await db.sql<{ id: string; passwordHash: string | null }>`
    SELECT id, password_hash FROM users WHERE email = ${email}`;
  // bcrypt считается всегда — и для несуществующего email
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) return { error: 'invalid', values };

  resetRateLimit(pairKey);
  resetRateLimit(emailKey);
  await startSession(user.id);
  redirect(safeNext(field(formData, 'next')) ?? `/${locale}/learn`);
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const locale = localeOf(formData);
  const rawName = field(formData, 'name');
  const email = normalizeEmail(field(formData, 'email')).slice(0, 254);
  const password = field(formData, 'password');
  const values = { email, name: rawName.slice(0, 100) };

  const ip = await clientIp();
  if (
    !allowed(
      ip === UNKNOWN_IP
        ? [`register:${UNKNOWN_IP}`, AUTH_LIMITS.registerUnknownIp]
        : [`register:${ip}`, AUTH_LIMITS.registerPerIp],
      [`register-email:${email}`, AUTH_LIMITS.registerPerEmail],
      [`register:${ip}:${email}`, AUTH_LIMITS.registerPerIpEmail],
    )
  ) {
    return { error: 'rate_limited', values };
  }

  const name = nameSchema.safeParse(rawName);
  if (!name.success || !emailSchema.safeParse(email).success) return { error: 'validation', values };
  const pwProblem = passwordProblem(password);
  if (pwProblem) return { error: pwProblem, values };
  if (field(formData, 'consent') !== 'on') return { error: 'consent', values };

  const passwordHash = await hashPassword(password);
  const db = await getDb();
  const userId = newId();
  const created = await db.tx(async (sql) => {
    const t = now();
    const rows = await sql`
      INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
      VALUES (${userId}, ${email}, ${passwordHash}, ${name.data}, 'learner', ${locale}, ${t})
      ON CONFLICT (email) DO NOTHING
      RETURNING id`;
    if (!rows.length) return false;
    await sql`
      INSERT INTO consents (id, user_id, order_id, kind, version, created_at)
      VALUES (${newId()}, ${userId}, NULL, 'pd_processing', ${PD_CONSENT_VERSION}, ${t})`;
    await writeAudit(sql, { actorId: userId, action: 'user.register', entity: 'user', entityId: userId, createdAt: t });
    return true;
  });
  if (!created) return { error: 'exists', values };

  await startSession(userId);
  redirect(safeNext(field(formData, 'next')) ?? `/${locale}/learn`);
}

export async function logoutAction(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  await endSession();
  redirect(`/${locale}`);
}

/** Вход в демо-аккаунт одной кнопкой: только в демо-режиме и только для DEMO_ACCOUNTS. */
export async function demoLoginAction(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const email = normalizeEmail(field(formData, 'email'));
  if (!isDemo() || !isDemoAccountEmail(email)) redirect(`/${locale}/login`);

  const db = await getDb();
  const [user] = await db.sql<{ id: string; role: string }>`SELECT id, role FROM users WHERE email = ${email}`;
  if (!user) redirect(`/${locale}/login`);

  await startSession(user.id);
  // без next — сразу в «свой» раздел роли, чтобы демо было наглядным
  const fallback =
    user.role === 'admin'
      ? `/${locale}/admin`
      : email.startsWith('manager@')
        ? `/${locale}/team`
        : `/${locale}/learn`;
  redirect(safeNext(field(formData, 'next')) ?? fallback);
}
