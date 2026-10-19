'use server';
// Server actions сброса пароля и подтверждения email. Нормативно: docs/lms/design/mail-account.md §3.3.
// Каждое действие первым делом проверяет флаг: выключено — unavailable и ни одной записи в БД.
// Запрос сброса всегда отвечает «отправлено», если email корректен (нет перечисления аккаунтов).
import { headers } from 'next/headers';
import { z } from 'zod';
import { isFeatureActive } from '../features';
import { getCurrentUser, normalizeEmail, requireUser } from './index';
import { deriveClientIp, UNKNOWN_IP } from './clientIp';
import { hashPassword, passwordProblem } from './password';
import { AUTH_LIMITS, rateLimit } from './rateLimit';
import { requestPasswordReset, resendVerification, resetPassword, verifyEmail } from './recovery';
import { safeNext } from './safeNext';
import { startSession } from './session';
import { isTokenShape } from './tokens';

export type RecoveryState =
  | { status: 'sent'; email: string }
  | { status: 'done'; next?: string; loggedIn?: boolean }
  | { status: 'error'; error: 'validation' | 'rate_limited' | 'invalid_token' | 'weak_password' | 'unavailable' }
  | undefined;

const emailSchema = z.string().max(254).email();
const unavailable: RecoveryState = { status: 'error', error: 'unavailable' };
const rateLimited: RecoveryState = { status: 'error', error: 'rate_limited' };

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === 'string' ? v : '';
}

function localeOf(fd: FormData): 'ru' | 'kz' {
  return field(fd, 'locale') === 'kz' ? 'kz' : 'ru';
}

async function clientIp(): Promise<string> {
  return deriveClientIp(await headers());
}

/** Запрос ссылки для смены пароля. Ответ не зависит от того, есть ли аккаунт и сработал ли лимит писем. */
export async function requestPasswordResetAction(_prev: RecoveryState, fd: FormData): Promise<RecoveryState> {
  if (!isFeatureActive('PASSWORD_RESET')) return unavailable;
  const email = normalizeEmail(field(fd, 'email')).slice(0, 254);
  if (!emailSchema.safeParse(email).success) return { status: 'error', error: 'validation' };

  const ip = await clientIp();
  const ipOk = ip === UNKNOWN_IP || rateLimit(`reset-request-ip:${ip}`, AUTH_LIMITS.resetRequestPerIp.limit, AUTH_LIMITS.resetRequestPerIp.windowMs).ok;
  const emailOk = rateLimit(`reset-request-email:${email}`, AUTH_LIMITS.resetRequestPerEmail.limit, AUTH_LIMITS.resetRequestPerEmail.windowMs).ok;
  if (!ipOk || !emailOk) return rateLimited;

  await requestPasswordReset({ email, locale: localeOf(fd) });
  return { status: 'sent', email };
}

/** Новый пароль по ссылке из письма; при успехе вход на этом устройстве, прочие сессии закрыты. */
export async function resetPasswordAction(_prev: RecoveryState, fd: FormData): Promise<RecoveryState> {
  if (!isFeatureActive('PASSWORD_RESET')) return unavailable;
  const ip = await clientIp();
  const lim = ip === UNKNOWN_IP ? AUTH_LIMITS.resetSubmitUnknownIp : AUTH_LIMITS.resetSubmitPerIp;
  if (!rateLimit(`reset-submit:${ip}`, lim.limit, lim.windowMs).ok) return rateLimited;

  const token = field(fd, 'token');
  if (!isTokenShape(token)) return { status: 'error', error: 'invalid_token' };
  const password = field(fd, 'password');
  const problem = passwordProblem(password);
  if (problem) return { status: 'error', error: problem };

  const passwordHash = await hashPassword(password);
  const res = await resetPassword({ token, passwordHash });
  if (!res.ok) return { status: 'error', error: 'invalid_token' };
  await startSession(res.userId);
  return { status: 'done' };
}

/** Подтверждение email по ссылке (POST). Вход не выполняется, next отдаётся только безопасный. */
export async function verifyEmailAction(_prev: RecoveryState, fd: FormData): Promise<RecoveryState> {
  if (!isFeatureActive('EMAIL_VERIFY')) return unavailable;
  const ip = await clientIp();
  if (ip !== UNKNOWN_IP) {
    const lim = AUTH_LIMITS.verifySubmitPerIp;
    if (!rateLimit(`verify-submit:${ip}`, lim.limit, lim.windowMs).ok) return rateLimited;
  }

  const token = field(fd, 'token');
  if (!isTokenShape(token)) return { status: 'error', error: 'invalid_token' };
  const res = await verifyEmail({ token });
  if (!res.ok) return { status: 'error', error: 'invalid_token' };

  const user = await getCurrentUser();
  const next = safeNext(field(fd, 'next')) ?? undefined;
  return { status: 'done', next, loggedIn: user?.id === res.userId };
}

/** Повторная отправка письма подтверждения; только для вошедшего, 3 в час. */
export async function resendVerificationAction(_prev: RecoveryState, fd: FormData): Promise<RecoveryState> {
  const locale = localeOf(fd);
  const user = await requireUser(locale);
  if (!isFeatureActive('EMAIL_VERIFY')) return unavailable;
  if (user.emailVerified) return { status: 'done' };
  const lim = AUTH_LIMITS.verifyResendPerUser;
  if (!rateLimit(`verify-resend:${user.id}`, lim.limit, lim.windowMs).ok) return rateLimited;

  const res = await resendVerification({ userId: user.id, locale, next: safeNext(field(fd, 'next')) });
  if (res.ok) return { status: 'sent', email: res.email };
  if (res.reason === 'already_verified') return { status: 'done' };
  return res.reason === 'rate_limited' ? rateLimited : unavailable;
}
