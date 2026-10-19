// Сценарии server actions сброса пароля и подтверждения email с подменой next/headers и next/navigation.
// Запускается из auth-recovery.test.ts (имена «recovery: …») и auth-verify.test.ts (имена «verify: …»)
// в отдельном процессе с --experimental-test-module-mocks. Как fixtures/auth-actions.flow.ts.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

type CookieOpts = { httpOnly?: boolean; sameSite?: string; secure?: boolean; expires?: Date };
const jar = new Map<string, { value: string; opts?: CookieOpts }>();
const hdrs = new Map<string, string>([['x-forwarded-for', '10.0.0.1']]);

class Redirect extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

mock.module('next/headers', {
  namedExports: {
    cookies: async () => ({
      get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)?.value } : undefined),
      set: (n: string, v: string, o: CookieOpts) => jar.set(n, { value: v, opts: o }),
      delete: (n: string) => jar.delete(n),
    }),
    headers: async () => ({ get: (n: string) => hdrs.get(n) ?? null }),
  },
});
mock.module('next/navigation', {
  namedExports: {
    redirect: (u: string) => {
      throw new Redirect(u);
    },
    notFound: () => {
      throw new Error('NOT_FOUND');
    },
  },
});

const { createTestDb } = await import('../../../src/lib/db/testing');
const { seedCourses } = await import('../../../src/lib/db/seed/run');
const R = await import('../../../src/lib/auth/recoveryActions');
const { hashPassword, verifyPassword } = await import('../../../src/lib/auth/password');
const { createSessionToken, resolveSessionToken, startSession, SESSION_COOKIE } = await import('../../../src/lib/auth/session');
const { getCurrentUser } = await import('../../../src/lib/auth/index');

const db = await createTestDb();
await seedCourses(db, []);
const oldHash = await hashPassword('old-password-1');

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

let seq = 0;
/** Новый пользователь с уникальным адресом и IP: лимиты в памяти не мешают друг другу. */
async function mkUser(verified = false): Promise<{ id: string; email: string }> {
  seq++;
  const id = `flow-${seq}`;
  const email = `flow${seq}@x.kz`;
  await db.sql`
    INSERT INTO users (id, email, password_hash, name, locale, email_verified_at, created_at)
    VALUES (${id}, ${email}, ${oldHash}, 'Тест', 'ru', ${verified ? 5 : null}, 1)`;
  hdrs.set('x-forwarded-for', `10.1.${Math.floor(seq / 250)}.${seq % 250}`);
  jar.clear();
  return { id, email };
}

async function secretOf(template: string, userId: string): Promise<string> {
  const [m] = await db.sql<{ secret: string }>`
    SELECT secret FROM mail_outbox WHERE template = ${template} AND user_id = ${userId} AND secret IS NOT NULL
    ORDER BY created_at DESC, id LIMIT 1`;
  assert.ok(m, 'нет письма со ссылкой');
  return m.secret;
}

async function rows(userId: string): Promise<{ tokens: number; mails: number }> {
  const [t] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM auth_tokens WHERE user_id = ${userId}`;
  const [m] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox WHERE user_id = ${userId}`;
  return { tokens: t?.n ?? 0, mails: m?.n ?? 0 };
}

async function withEnv(name: string, value: string, fn: () => Promise<void>): Promise<void> {
  const prev = process.env[name];
  process.env[name] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

// ---------- сброс пароля ----------

test('recovery: запрос отвечает одинаково для известного, неизвестного и демо-аккаунта; ошибка — только по формату', async () => {
  const u = await mkUser();
  const known = await R.requestPasswordResetAction(undefined, fd({ email: u.email.toUpperCase(), locale: 'ru' }));
  const unknown = await R.requestPasswordResetAction(undefined, fd({ email: 'nobody-here@x.kz', locale: 'ru' }));
  const seedUser = await R.requestPasswordResetAction(undefined, fd({ email: 'client@crp.demo', locale: 'ru' }));
  assert.deepEqual(known, { status: 'sent', email: u.email });
  assert.deepEqual(unknown, { status: 'sent', email: 'nobody-here@x.kz' });
  assert.deepEqual(seedUser, { status: 'sent', email: 'client@crp.demo' });
  assert.deepEqual(await rows(u.id), { tokens: 1, mails: 1 });
  const [other] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM mail_outbox WHERE to_email IN ('nobody-here@x.kz', 'client@crp.demo')`;
  assert.equal(other?.n, 0, 'неизвестному и демо-аккаунту ничего не отправлено');
  assert.deepEqual(await R.requestPasswordResetAction(undefined, fd({ email: 'не-адрес', locale: 'ru' })), { status: 'error', error: 'validation' });
});

test('recovery: четвёртый запрос на один email за час — rate_limited, даже для неизвестного адреса', async () => {
  const u = await mkUser();
  for (let i = 0; i < 3; i++) {
    assert.equal((await R.requestPasswordResetAction(undefined, fd({ email: u.email, locale: 'ru' })))?.status, 'sent');
  }
  assert.deepEqual(await R.requestPasswordResetAction(undefined, fd({ email: u.email, locale: 'ru' })), { status: 'error', error: 'rate_limited' });
  for (let i = 0; i < 3; i++) await R.requestPasswordResetAction(undefined, fd({ email: 'ghost-x@x.kz', locale: 'ru' }));
  assert.deepEqual(await R.requestPasswordResetAction(undefined, fd({ email: 'ghost-x@x.kz', locale: 'ru' })), { status: 'error', error: 'rate_limited' });
});

test('recovery: смена пароля — слабый пароль не тратит токен, успех входит и закрывает прочие сессии', async () => {
  const u = await mkUser();
  const elsewhere = await createSessionToken(u.id);
  await R.requestPasswordResetAction(undefined, fd({ email: u.email, locale: 'ru' }));
  const token = await secretOf('password_reset', u.id);

  assert.deepEqual(await R.resetPasswordAction(undefined, fd({ token, password: 'short' })), { status: 'error', error: 'weak_password' });
  assert.deepEqual(await R.resetPasswordAction(undefined, fd({ token: 'мусор', password: 'new-password-1' })), { status: 'error', error: 'invalid_token' });
  assert.ok(await resolveSessionToken(elsewhere.token), 'неудачные попытки сессий не трогают');

  assert.deepEqual(await R.resetPasswordAction(undefined, fd({ token, password: 'new-password-1' })), { status: 'done' });
  assert.equal(jar.get(SESSION_COOKIE)?.opts?.httpOnly, true, 'cookie выдана');
  assert.equal((await getCurrentUser())?.id, u.id, 'вход на этом устройстве');
  assert.equal(await resolveSessionToken(elsewhere.token), null, 'прочие сессии закрыты');
  const [row] = await db.sql<{ passwordHash: string }>`SELECT password_hash FROM users WHERE id = ${u.id}`;
  assert.equal(await verifyPassword('new-password-1', row?.passwordHash), true);

  assert.deepEqual(await R.resetPasswordAction(undefined, fd({ token, password: 'another-pass-1' })), { status: 'error', error: 'invalid_token' });
});

test('recovery: флаг PASSWORD_RESET выключен — unavailable и ни одной записи', async () => {
  const u = await mkUser();
  await withEnv('FEATURE_PASSWORD_RESET', '0', async () => {
    assert.deepEqual(await R.requestPasswordResetAction(undefined, fd({ email: u.email, locale: 'ru' })), { status: 'error', error: 'unavailable' });
    assert.deepEqual(await R.resetPasswordAction(undefined, fd({ token: 'A'.repeat(43), password: 'new-password-1' })), { status: 'error', error: 'unavailable' });
  });
  assert.deepEqual(await rows(u.id), { tokens: 0, mails: 0 });
});

test('recovery: лимит смены пароля по IP — 21-я попытка за окно отклонена', async () => {
  await mkUser();
  let last: Awaited<ReturnType<typeof R.resetPasswordAction>>;
  for (let i = 0; i < 21; i++) last = await R.resetPasswordAction(undefined, fd({ token: 'A'.repeat(43), password: 'new-password-1' }));
  assert.deepEqual(last, { status: 'error', error: 'rate_limited' });
});

// ---------- подтверждение email ----------

test('verify: подтверждение по ссылке не входит в аккаунт, повтор — invalid_token, чужой next отброшен', async () => {
  const u = await mkUser();
  const { sendVerification } = await import('../../../src/lib/auth/recovery');
  await db.tx((sql) => sendVerification(sql, { userId: u.id, email: u.email, name: 'Тест', locale: 'ru' }));
  const token = await secretOf('email_verify', u.id);

  assert.deepEqual(await R.verifyEmailAction(undefined, fd({ token: 'A'.repeat(42) })), { status: 'error', error: 'invalid_token' });
  const res = await R.verifyEmailAction(undefined, fd({ token, next: 'https://evil.example/x' }));
  assert.deepEqual(res, { status: 'done', next: undefined, loggedIn: false });
  assert.equal(jar.has(SESSION_COOKIE), false, 'подтверждение не создаёт сессию');
  const [row] = await db.sql<{ emailVerifiedAt: number | null }>`SELECT email_verified_at FROM users WHERE id = ${u.id}`;
  assert.ok(row?.emailVerifiedAt);
  assert.deepEqual(await R.verifyEmailAction(undefined, fd({ token })), { status: 'error', error: 'invalid_token' });
});

test('verify: loggedIn только для сессии того же пользователя, безопасный next возвращается', async () => {
  const u = await mkUser();
  const stranger = await mkUser(true);
  const { sendVerification } = await import('../../../src/lib/auth/recovery');
  const issue = async () => {
    await db.tx((sql) => sendVerification(sql, { userId: u.id, email: u.email, name: 'Тест', locale: 'ru' }));
    return secretOf('email_verify', u.id);
  };

  jar.clear();
  await startSession(stranger.id);
  const other = await R.verifyEmailAction(undefined, fd({ token: await issue(), next: '/ru/courses/x/buy' }));
  assert.deepEqual(other, { status: 'done', next: '/ru/courses/x/buy', loggedIn: false });

  await db.sql`UPDATE users SET email_verified_at = NULL WHERE id = ${u.id}`;
  jar.clear();
  await startSession(u.id);
  const own = await R.verifyEmailAction(undefined, fd({ token: await issue(), next: '/ru/courses/x/buy' }));
  assert.deepEqual(own, { status: 'done', next: '/ru/courses/x/buy', loggedIn: true });
});

test('verify: повторная отправка — 4-я за час rate_limited, подтверждённому — done без письма', async () => {
  const u = await mkUser();
  await startSession(u.id);
  for (let i = 0; i < 3; i++) {
    const r = await R.resendVerificationAction(undefined, fd({ locale: 'ru', next: '/ru/courses/x/buy' }));
    assert.deepEqual(r, { status: 'sent', email: u.email });
  }
  assert.deepEqual(await R.resendVerificationAction(undefined, fd({ locale: 'ru' })), { status: 'error', error: 'rate_limited' });
  const [live] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM auth_tokens WHERE user_id = ${u.id} AND used_at IS NULL`;
  assert.equal(live?.n, 1, 'жива только последняя ссылка');

  const v = await mkUser(true);
  await startSession(v.id);
  assert.deepEqual(await R.resendVerificationAction(undefined, fd({ locale: 'ru' })), { status: 'done' });
  assert.deepEqual(await rows(v.id), { tokens: 0, mails: 0 });
});

test('verify: гость при повторной отправке уходит на вход; флаг выключен — unavailable без записей', async () => {
  const u = await mkUser();
  await assert.rejects(R.resendVerificationAction(undefined, fd({ locale: 'ru' })), (e: unknown) => e instanceof Redirect && e.url === '/ru/login');
  await startSession(u.id);
  await withEnv('FEATURE_EMAIL_VERIFY', '0', async () => {
    assert.deepEqual(await R.resendVerificationAction(undefined, fd({ locale: 'ru' })), { status: 'error', error: 'unavailable' });
    assert.deepEqual(await R.verifyEmailAction(undefined, fd({ token: 'A'.repeat(43) })), { status: 'error', error: 'unavailable' });
  });
  assert.deepEqual(await rows(u.id), { tokens: 0, mails: 0 });
});
