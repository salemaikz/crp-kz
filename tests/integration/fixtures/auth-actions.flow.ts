// Сценарии server actions авторизации с подменой next/headers и next/navigation.
// Запускается из core-auth-actions.test.ts в отдельном процессе с --experimental-test-module-mocks.
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
    permanentRedirect: (u: string) => {
      throw new Redirect(u);
    },
    // next-intl/navigation (через orders/actions) импортирует клиентские хуки; в тестах не вызываются
    usePathname: () => '/',
    useRouter: () => ({}),
    useParams: () => ({}),
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

test('login: лимит на email действует при смене IP (перебор с разных адресов)', async () => {
  // по 7 попыток с трёх адресов: лимит IP+email (8) не срабатывает, лимит на email (20) — да
  let last: State;
  for (let n = 0; n < 3; n++) {
    hdrs.set('x-forwarded-for', `203.0.113.${n + 1}`);
    for (let i = 0; i < 7; i++) {
      last = await A.loginAction(undefined, fd({ email: 'manager@crp.demo', password: 'bad-bad-bad', locale: 'ru' }));
    }
  }
  assert.equal(last?.error, 'rate_limited');
  hdrs.set('x-forwarded-for', '203.0.113.200');
  const ok = await outcome(A.loginAction(undefined, fd({ email: 'manager@crp.demo', password: 'demo12345', locale: 'ru' })));
  assert.equal(ok.error, 'rate_limited', 'новый IP не обходит лимит на аккаунт');
  // другой аккаунт с того же адреса не заблокирован
  const other = await A.loginAction(undefined, fd({ email: 'operator@crp.demo', password: 'bad-bad-bad', locale: 'ru' }));
  assert.equal(other?.error, 'invalid');
  hdrs.set('x-forwarded-for', '10.0.0.1');
});

test('login: подделанный левый X-Forwarded-For не меняет IP клиента', async () => {
  // при TRUSTED_PROXY_HOPS=1 значения левее последнего — от клиента и не учитываются
  let last: State;
  for (let i = 0; i < 9; i++) {
    hdrs.set('x-forwarded-for', `198.51.100.${i}, 192.0.2.77`);
    last = await A.loginAction(undefined, fd({ email: 'nobody2@crp.demo', password: 'bad-bad-bad', locale: 'ru' }));
  }
  assert.equal(last?.error, 'rate_limited');
  hdrs.set('x-forwarded-for', '10.0.0.1');
});

const { REGISTER_CONSENTS } = await import('../../../src/lib/legal/types');
const { versionsToken } = await import('../../../src/lib/legal/registry');
const legalToken = versionsToken(REGISTER_CONSENTS, { allowDrafts: true });

type ConsentRow = {
  kind: string;
  version: string;
  locale: string | null;
  context: string | null;
  textSha256: string | null;
};
const consentsOf = (email: string) =>
  db.sql<ConsentRow>`
    SELECT c.kind, c.version, c.locale, c.context, c.text_sha256 FROM consents c
    JOIN users u ON u.id = c.user_id WHERE u.email = ${email}`;
const userCount = async (email: string) =>
  Number((await db.sql<{ n: number }>`SELECT count(*) AS n FROM users WHERE email = ${email}`)[0]?.n);
const verifyMails = (email: string) =>
  db.sql<{ params: { next: string | null }; secret: string | null }>`
    SELECT params, secret FROM mail_outbox WHERE template = 'email_verify' AND to_email = ${email}`;

async function withEnv(vars: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('register: согласие, слабый пароль, валидация, занятый email, успех', async () => {
  const base = { name: 'Тест', email: 'new@x.kz', password: 'longpassword', consent: 'on', locale: 'ru', legalToken };
  assert.equal((await A.registerAction(undefined, fd({ ...base, consent: '' })))?.error, 'consent');
  assert.equal((await A.registerAction(undefined, fd({ ...base, password: 'short' })))?.error, 'weak_password');
  assert.equal((await A.registerAction(undefined, fd({ ...base, email: 'bad' })))?.error, 'validation');
  assert.equal((await A.registerAction(undefined, fd({ ...base, email: 'client@crp.demo' })))?.error, 'exists');
  assert.equal(await userCount('new@x.kz'), 0, 'ошибки формы пользователя не создают');
  const r = await outcome(A.registerAction(undefined, fd({ ...base, next: '/ru/courses/x' })));
  assert.equal(r.url, '/ru/courses/x');
  // LEGAL активен (демо): действующая редакция, язык показанного текста, контекст и хэш текста
  const rows = await consentsOf('new@x.kz');
  assert.equal(rows.length, 1);
  const [c] = rows;
  assert.equal(c?.kind, 'pd_processing');
  assert.notEqual(c?.version, '2026-10-19');
  assert.equal(c?.locale, 'ru');
  assert.equal(c?.context, 'register');
  assert.match(c?.textSha256 ?? '', /^[0-9a-f]{64}$/);
  assert.equal((await getCurrentUser())?.email, 'new@x.kz');
});

test('register: письмо подтверждения ставится в транзакции регистрации, next безопасный; без флага письма нет', async () => {
  const base = { name: 'Тест', password: 'longpassword', consent: 'on', locale: 'kz', legalToken };
  const r = await outcome(A.registerAction(undefined, fd({ ...base, email: 'mail1@x.kz', next: '/kz/courses/x/buy' })));
  assert.equal(r.url, '/kz/courses/x/buy');
  const mails = await verifyMails('mail1@x.kz');
  assert.equal(mails.length, 1);
  assert.equal(mails[0]?.params.next, '/kz/courses/x/buy');
  assert.ok(mails[0]?.secret, 'ссылка в очереди');
  const [u] = await db.sql<{ emailVerifiedAt: number | null }>`SELECT email_verified_at FROM users WHERE email = 'mail1@x.kz'`;
  assert.equal(u?.emailVerifiedAt, null);

  await outcome(A.registerAction(undefined, fd({ ...base, email: 'mail2@x.kz', next: 'https://evil.example/x' })));
  assert.equal((await verifyMails('mail2@x.kz'))[0]?.params.next, null, 'чужой адрес отброшен');

  await withEnv({ FEATURE_EMAIL_VERIFY: '0' }, async () => {
    await outcome(A.registerAction(undefined, fd({ ...base, email: 'mail3@x.kz' })));
    assert.equal(await userCount('mail3@x.kz'), 1);
    assert.equal((await verifyMails('mail3@x.kz')).length, 0, 'EMAIL_VERIFY выключен: письма нет');
  });
});

test('register: лимит писем регистрацию не откатывает', async () => {
  await withEnv({ MAIL_AUTH_HOURLY_CAP: '1' }, async () => {
    const r = await outcome(
      A.registerAction(undefined, fd({ name: 'Тест', email: 'cap@x.kz', password: 'longpassword', consent: 'on', locale: 'ru', legalToken })),
    );
    assert.equal(r.error, undefined);
    assert.equal(await userCount('cap@x.kz'), 1, 'пользователь создан');
    assert.equal((await verifyMails('cap@x.kz')).length, 0, 'письмо не встало в очередь');
    assert.equal((await consentsOf('cap@x.kz')).length, 1);
  });
});

test('register: устаревший или чужой legalToken — legal_changed, пользователь и согласия не созданы', async () => {
  const base = { name: 'Тест', email: 'stale@x.kz', password: 'longpassword', consent: 'on', locale: 'ru' };
  for (const bad of [undefined, '', 'pd_consent@1999-01-01', 'offer@2026-10-20', `${legalToken};privacy@2026-10-20`]) {
    const r = await A.registerAction(undefined, fd(bad === undefined ? base : { ...base, legalToken: bad }));
    assert.equal(r?.error, 'legal_changed', String(bad));
    assert.equal(r?.legalToken, legalToken, 'форме выдан актуальный токен');
  }
  assert.equal(await userCount('stale@x.kz'), 0);
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM consents c JOIN users u ON u.id = c.user_id WHERE u.email = 'stale@x.kz'`;
  assert.equal(Number(n?.n), 0);
  assert.equal((await verifyMails('stale@x.kz')).length, 0);
});

test('register: FEATURE_LEGAL=0 — как до плана: токена нет, согласие легаси без хэша', async () => {
  await withEnv({ FEATURE_LEGAL: '0' }, async () => {
    const r = await outcome(
      A.registerAction(undefined, fd({ name: 'Тест', email: 'legacy@x.kz', password: 'longpassword', consent: 'on', locale: 'ru' })),
    );
    assert.equal(r.error, undefined);
    const rows = await consentsOf('legacy@x.kz');
    assert.deepEqual(
      rows.map((c) => [c.kind, c.version, c.locale, c.textSha256]),
      [['pd_processing', '2026-10-19', null, null]],
    );
  });
});

test('createOrderAction: токен версий, режим формы и неподтверждённый email', async () => {
  const O = await import('../../../src/lib/orders/actions');
  const { CHECKOUT_CONSENTS } = await import('../../../src/lib/legal/types');
  const checkoutToken = versionsToken(CHECKOUT_CONSENTS, { allowDrafts: true });
  // сессия неподтверждённого аккаунта из предыдущих сценариев регистрации
  assert.ok(await getCurrentUser(), 'есть вошедший пользователь');
  const base = {
    courseSlug: 'sales-doubling',
    buyerType: 'person',
    name: 'Покупатель',
    phone: '+7 701 100 09 29',
    paymentMethod: 'kaspi',
    consentOffer: 'on',
    consentPd: 'on',
    locale: 'ru',
  };
  const tables = async () => {
    const [o] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM orders`;
    const [c] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM consents WHERE context <> 'register'`;
    return [Number(o?.n), Number(c?.n)];
  };
  const before = await tables();

  // без токена, со старым и чужим: legal_changed, галочки сброшены, выдан актуальный токен
  for (const bad of ['', 'pd_consent@1999-01-01', `${checkoutToken};privacy@2026-10-20`]) {
    const r = await O.createOrderAction(undefined, fd({ ...base, legalToken: bad }));
    assert.equal(r?.error, 'legal_changed', bad);
    assert.equal(r?.legalToken, checkoutToken);
    assert.equal(r?.values.consentOffer, false);
    assert.equal(r?.values.consentPd, false);
  }
  // форма без поля токена (отрисована до включения LEGAL): тоже legal_changed, а не validation
  const noField = await O.createOrderAction(undefined, fd({ ...base, consentOffer: '', consentPd: '', consent: 'on' }));
  assert.equal(noField?.error, 'legal_changed');
  assert.equal(noField?.legalToken, checkoutToken);
  assert.deepEqual(await tables(), before, 'заказов и согласий нет');

  // верный токен, но email не подтверждён
  const unverified = await O.createOrderAction(undefined, fd({ ...base, legalToken: checkoutToken }));
  assert.equal(unverified?.error, 'email_unverified');
  assert.deepEqual(await tables(), before, 'заказов и согласий нет');

  // LEGAL выключен, а форма с токеном: перечитать страницу, без токена в ответе
  await withEnv({ FEATURE_LEGAL: '0' }, async () => {
    const r = await O.createOrderAction(undefined, fd({ ...base, legalToken: checkoutToken }));
    assert.equal(r?.error, 'legal_changed');
    assert.equal(r?.legalToken, undefined);
  });
});

test('демо-вход одной кнопкой не пускает в обычный аккаунт на демо-адресе (проверка по id сида)', async () => {
  jar.clear();
  await db.sql`UPDATE users SET email = 'moved-away@x.kz' WHERE email = 'operator@crp.demo'`;
  const squatterId = 'squatter-user';
  await db.sql`INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
               VALUES (${squatterId}, 'operator@crp.demo', 'x', 'Другой', 'learner', 'ru', 1)`;
  try {
    const r = await outcome(A.demoLoginAction(fd({ email: 'operator@crp.demo', locale: 'ru' })));
    assert.equal(r.url, '/ru/login');
    assert.equal(jar.has('crp_session'), false);
  } finally {
    await db.sql`DELETE FROM users WHERE id = ${squatterId}`;
    await db.sql`UPDATE users SET email = 'operator@crp.demo' WHERE email = 'moved-away@x.kz'`;
  }
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
