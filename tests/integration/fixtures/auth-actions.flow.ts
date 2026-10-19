// Сценарии server actions авторизации с подменой next/headers и next/navigation.
// Запускается из core-auth-actions.test.ts в отдельном процессе с --experimental-test-module-mocks.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

type CookieOpts = { httpOnly?: boolean; sameSite?: string; secure?: boolean; expires?: Date };
const jar = new Map<string, { value: string; opts?: CookieOpts }>();
const hdrs = new Map<string, string>([['x-forwarded-for', '10.0.0.1, 1.1.1.1']]);

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
const A = await import('../../../src/lib/auth/actions');
const { getCurrentUser, requireUser } = await import('../../../src/lib/auth/index');
type State = Awaited<ReturnType<typeof A.loginAction>>;

const db = await createTestDb();
await seedCourses(db, []);

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

async function outcome(p: Promise<unknown>): Promise<{ url?: string; error?: string }> {
  try {
    const r = (await p) as State | void;
    return { error: r ? r.error : undefined };
  } catch (e) {
    if (e instanceof Redirect) return { url: e.url };
    throw e;
  }
}

test('login: неверный пароль и несуществующий email — одинаковая ошибка', async () => {
  const wrong = await A.loginAction(undefined, fd({ email: 'client@crp.demo', password: 'wrong-pass', locale: 'ru' }));
  const nobody = await A.loginAction(undefined, fd({ email: 'nobody@crp.demo', password: 'wrong-pass', locale: 'ru' }));
  assert.deepEqual(wrong, { error: 'invalid', values: { email: 'client@crp.demo' } });
  assert.deepEqual(nobody, { error: 'invalid', values: { email: 'nobody@crp.demo' } });
  const empty = await A.loginAction(undefined, fd({ email: '', password: '', locale: 'ru' }));
  assert.equal(empty?.error, 'validation');
});

test('login: успех → httpOnly cookie и редирект на безопасный next или /learn', async () => {
  const r = await outcome(
    A.loginAction(undefined, fd({ email: ' Client@CRP.demo ', password: 'demo12345', locale: 'kz', next: 'https://evil.com' })),
  );
  assert.equal(r.url, '/kz/learn');
  const opts = jar.get('crp_session')?.opts;
  assert.equal(opts?.httpOnly, true);
  assert.equal(opts?.sameSite, 'lax');
  assert.equal((await getCurrentUser())?.email, 'client@crp.demo');
  const r2 = await outcome(
    A.loginAction(undefined, fd({ email: 'client@crp.demo', password: 'demo12345', locale: 'ru', next: '/ru/learn/x' })),
  );
  assert.equal(r2.url, '/ru/learn/x');
  const [row] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM sessions`;
  assert.equal(row?.n, 1, 'прежняя сессия удалена при новом входе');
});

test('login: лимит частоты по IP+email, даже для верного пароля', async () => {
  hdrs.set('x-forwarded-for', '10.0.0.99');
  let last: State;
  for (let i = 0; i < 9; i++) {
    last = await A.loginAction(undefined, fd({ email: 'admin@crp.demo', password: 'bad-bad-bad', locale: 'ru' }));
  }
  assert.equal(last?.error, 'rate_limited');
  const ok = await outcome(A.loginAction(undefined, fd({ email: 'admin@crp.demo', password: 'demo12345', locale: 'ru' })));
  assert.equal(ok.error, 'rate_limited');
  hdrs.set('x-forwarded-for', '10.0.0.1');
});

test('register: согласие, слабый пароль, валидация, занятый email, успех', async () => {
  const base = { name: 'Тест', email: 'new@x.kz', password: 'longpassword', consent: 'on', locale: 'ru' };
  assert.equal((await A.registerAction(undefined, fd({ ...base, consent: '' })))?.error, 'consent');
  assert.equal((await A.registerAction(undefined, fd({ ...base, password: 'short' })))?.error, 'weak_password');
  assert.equal((await A.registerAction(undefined, fd({ ...base, email: 'bad' })))?.error, 'validation');
  assert.equal((await A.registerAction(undefined, fd({ ...base, email: 'client@crp.demo' })))?.error, 'exists');
  const r = await outcome(A.registerAction(undefined, fd({ ...base, next: '/ru/courses/x' })));
  assert.equal(r.url, '/ru/courses/x');
  const [c] = await db.sql<{ kind: string; version: string }>`
    SELECT c.kind, c.version FROM consents c JOIN users u ON u.id = c.user_id WHERE u.email = 'new@x.kz'`;
  assert.deepEqual(c, { kind: 'pd_processing', version: '2026-10-19' });
  assert.equal((await getCurrentUser())?.email, 'new@x.kz');
});

test('logout, демо-вход и requireUser', async () => {
  assert.equal((await outcome(A.logoutAction(fd({ locale: 'kz' })))).url, '/kz');
  assert.equal(jar.has('crp_session'), false);
  assert.equal((await outcome(A.demoLoginAction(fd({ email: 'admin@crp.demo', locale: 'ru' })))).url, '/ru/admin');
  assert.equal((await outcome(A.demoLoginAction(fd({ email: 'new@x.kz', locale: 'ru' })))).url, '/ru/login');
  const withNext = await outcome(A.demoLoginAction(fd({ email: 'operator@crp.demo', locale: 'ru', next: '/ru/learn/op' })));
  assert.equal(withNext.url, '/ru/learn/op');
  process.env.DATABASE_URL = 'postgres://unused'; // только переключает isDemo()
  process.env.SESSION_SECRET = 'x'.repeat(40);
  assert.equal((await outcome(A.demoLoginAction(fd({ email: 'admin@crp.demo', locale: 'ru' })))).url, '/ru/login');
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  jar.clear();
  const rq = await outcome(requireUser('ru', '/ru/learn/a?b=1'));
  assert.equal(rq.url, '/ru/login?next=%2Fru%2Flearn%2Fa%3Fb%3D1');
});
