// Каталог: видимость курсов (internal — только членам организации, черновики и private скрыты),
// состояния кнопки на странице курса, самозачисление «Начать бесплатно».
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { canAccessCourse, enroll, getEnrollment, revokeEnrollment } from '../../src/lib/access';
import { resolveCourseCta } from '../../src/lib/catalog/cta';
import {
  getCatalogStats,
  getCourseDetail,
  getCourseProgram,
  getMemberOrgIds,
  getViewerStates,
  listCatalogCourses,
  listFeaturedCourses,
} from '../../src/lib/catalog/queries';
import { startCourse } from '../../src/lib/catalog/start';
import type { CatalogCourse } from '../../src/lib/catalog/types';
import {
  accessPeriod,
  isCourseVisible,
  isFreeCourse,
  matchesFilter,
  parseFilter,
} from '../../src/lib/catalog/visibility';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';

let db: TestDb;

type CourseOpts = {
  visibility?: 'public' | 'internal' | 'private';
  owner?: string | null;
  status?: 'draft' | 'published';
  price?: number | null;
  active?: boolean;
  accessDays?: number | null;
  position?: number;
};

async function course(id: string, o: CourseOpts = {}) {
  await db.sql`
    INSERT INTO courses (id, slug, title, summary, description, level, duration_min, visibility, owner_org_id,
                         status, position, created_at, updated_at)
    VALUES (${id}, ${id}, ${db.json({ ru: `Курс ${id}`, kz: `Курс ${id} kz` })}, ${db.json({ ru: `О ${id}` })},
            ${db.json({ ru: `## Описание ${id}` })}, 'base', 60, ${o.visibility ?? 'public'}, ${o.owner ?? null},
            ${o.status ?? 'published'}, ${o.position ?? 0}, 1, 1)`;
  if (o.price !== undefined && o.price !== null) {
    await db.sql`
      INSERT INTO course_offers (id, course_id, price_kzt, access_days, active, created_at)
      VALUES (${'offer-' + id}, ${id}, ${o.price}, ${o.accessDays ?? null}, ${o.active ?? true}, 1)`;
  }
}

/** Модуль и уроки курса: статусы уроков задают, что видно в программе и счётчиках. */
async function lessons(courseId: string, statuses: Array<'draft' | 'published'>, moduleId = `m-${courseId}`) {
  await db.sql`
    INSERT INTO course_modules (id, course_id, position, title, created_at)
    VALUES (${moduleId}, ${courseId}, 0, ${db.json({ ru: 'Модуль' })}, 1)
    ON CONFLICT (id) DO NOTHING`;
  for (const [i, status] of statuses.entries()) {
    await db.sql`
      INSERT INTO lessons (id, course_id, module_id, position, slug, title, duration_min, status, created_at, updated_at)
      VALUES (${`l-${courseId}-${i}`}, ${courseId}, ${moduleId}, ${i}, ${`s${i}`},
              ${db.json({ ru: `Урок ${i + 1}` })}, 10, ${status}, 1, 1)`;
  }
}

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES
    ('orgA', 'crp', 'ЦРП', 'owner', 1), ('orgB', 'client', 'Клиент', 'client', 1)`;
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES
    ('uA', 'a@x.kz', 'Сотрудник A', 1), ('uB', 'b@x.kz', 'Сотрудник B', 1), ('guestUser', 'g@x.kz', 'Без организации', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES
    ('orgA', 'uA', 'member', 1), ('orgB', 'uB', 'member', 1)`;

  await course('free', { position: 1 });
  await course('paid', { price: 99000, accessDays: 365, position: 2 });
  await course('paused', { price: 5000, active: false, position: 3 });
  await course('zero', { price: 0, position: 4 });
  await course('internalA', { visibility: 'internal', owner: 'orgA', position: 5 });
  await course('internalB', { visibility: 'internal', owner: 'orgB', position: 6 });
  await course('private', { visibility: 'private', position: 7 });
  await course('draft', { status: 'draft', position: 8 });
  await course('draftInternal', { visibility: 'internal', owner: 'orgA', status: 'draft', position: 9 });
  await lessons('free', ['published', 'published', 'draft']);
  await lessons('paid', ['published']);
  await lessons('internalA', ['published', 'published']);
});
after(async () => {
  await db.close();
});

const slugs = (list: CatalogCourse[]) => list.map((c) => c.slug);

test('isCourseVisible: черновик скрыт всегда, private — всем, internal — только членам организации-владельца', () => {
  const base = { status: 'published', visibility: 'public', ownerOrgId: null };
  assert.equal(isCourseVisible(base, []), true);
  assert.equal(isCourseVisible({ ...base, status: 'draft' }, []), false);
  assert.equal(isCourseVisible({ ...base, visibility: 'private' }, ['orgA']), false);
  const internal = { status: 'published', visibility: 'internal', ownerOrgId: 'orgA' };
  assert.equal(isCourseVisible(internal, []), false);
  assert.equal(isCourseVisible(internal, ['orgB']), false);
  assert.equal(isCourseVisible(internal, ['orgA']), true);
  assert.equal(isCourseVisible({ ...internal, status: 'draft' }, ['orgA']), false);
  // internal без организации-владельца никому не виден (не «открыт всем»)
  assert.equal(isCourseVisible({ ...internal, ownerOrgId: null }, ['orgA']), false);
});

test('каталог гостя: только опубликованные public; internal, private и черновики скрыты', async () => {
  const list = await listCatalogCourses([]);
  assert.deepEqual(slugs(list), ['free', 'paid', 'paused', 'zero']);
});

test('каталог сотрудника: public + internal своей организации, чужой internal не виден', async () => {
  const a = await listCatalogCourses(await getMemberOrgIds('uA'));
  assert.deepEqual(slugs(a), ['free', 'paid', 'paused', 'zero', 'internalA']);
  const b = await listCatalogCourses(await getMemberOrgIds('uB'));
  assert.deepEqual(slugs(b), ['free', 'paid', 'paused', 'zero', 'internalB']);
  // пользователь без организаций — как гость
  assert.deepEqual(slugs(await listCatalogCourses(await getMemberOrgIds('guestUser'))), ['free', 'paid', 'paused', 'zero']);
  assert.deepEqual(await getMemberOrgIds(null), []);
});

test('страница курса: 404 (null) для черновика, private, чужого internal и несуществующего', async () => {
  assert.equal(await getCourseDetail('draft', []), null);
  assert.equal(await getCourseDetail('draftInternal', ['orgA']), null);
  assert.equal(await getCourseDetail('private', ['orgA']), null);
  assert.equal(await getCourseDetail('internalA', []), null);
  assert.equal(await getCourseDetail('internalA', ['orgB']), null);
  assert.equal(await getCourseDetail('missing', ['orgA']), null);
  assert.equal((await getCourseDetail('internalA', ['orgA']))?.slug, 'internalA');
  assert.equal((await getCourseDetail('free', []))?.slug, 'free');
});

test('курс: цена из offer, счётчики считают только опубликованные уроки, модули без них не в счёте', async () => {
  const free = await getCourseDetail('free', []);
  assert.ok(free);
  assert.equal(free.lessonsCount, 2);
  assert.equal(free.modulesCount, 1);
  assert.equal(free.priceKzt, null);
  assert.equal(isFreeCourse(free), true);
  const paid = await getCourseDetail('paid', []);
  assert.equal(paid?.priceKzt, 99000);
  assert.equal(paid?.accessDays, 365);
  assert.equal(paid?.offerActive, true);
  const paused = await getCourseDetail('paused', []);
  assert.equal(paused?.offerActive, false);
  assert.equal(isFreeCourse(paused as CatalogCourse), false);
  // offer с ценой 0 — бесплатный курс
  assert.equal(isFreeCourse((await getCourseDetail('zero', [])) as CatalogCourse), true);
  const noLessons = await getCourseDetail('zero', []);
  assert.equal(noLessons?.modulesCount, 0);
  assert.equal(noLessons?.lessonsCount, 0);
});

test('программа курса: только опубликованные уроки, без содержимого', async () => {
  const program = await getCourseProgram('free');
  assert.equal(program.length, 1);
  assert.deepEqual(
    program[0]?.lessons.map((l) => Object.keys(l).sort()),
    [
      ['durationMin', 'id', 'title'],
      ['durationMin', 'id', 'title'],
    ],
  );
  assert.equal(program[0]?.durationMin, 20);
  assert.deepEqual(await getCourseProgram('zero'), []);
});

test('фильтры каталога и ?f=', async () => {
  const list = await listCatalogCourses(['orgA']);
  const by = (f: Parameters<typeof matchesFilter>[1]) => slugs(list.filter((c) => matchesFilter(c, f)));
  assert.deepEqual(by('all'), ['free', 'paid', 'paused', 'zero', 'internalA']);
  assert.deepEqual(by('paid'), ['paid', 'paused']);
  assert.deepEqual(by('free'), ['free', 'zero']);
  assert.deepEqual(by('staff'), ['internalA']);
  assert.equal(parseFilter('paid'), 'paid');
  assert.equal(parseFilter(['free', 'paid']), 'free');
  assert.equal(parseFilter('hack'), 'all');
  assert.equal(parseFilter(undefined), 'all');
});

test('срок доступа: 365 дней → 12 месяцев, нестандартный — в днях, нет срока — null', () => {
  assert.deepEqual(accessPeriod(365), { unit: 'month', value: 12 });
  assert.deepEqual(accessPeriod(90), { unit: 'month', value: 3 });
  assert.deepEqual(accessPeriod(100), { unit: 'day', value: 100 });
  assert.deepEqual(accessPeriod(14), { unit: 'day', value: 14 });
  assert.equal(accessPeriod(null), null);
});

test('витрина и цифры лендинга: публичные опубликованные курсы и уроки', async () => {
  const stats = await getCatalogStats();
  assert.equal(stats.courses, 4); // free, paid, paused, zero
  assert.equal(stats.lessons, 3); // 2 + 1 опубликованных; черновой урок не считается
  assert.deepEqual(slugs(await listFeaturedCourses(2)), ['free', 'paid']);
});

// ---------- кнопка на странице курса ----------

const NONE = { ok: false, reason: 'none' } as const;

test('CTA: есть действующее зачисление → «Продолжить» (даже у платного)', () => {
  const access = { ok: true } as const;
  for (const visibility of ['public', 'internal'] as const) {
    assert.deepEqual(
      resolveCourseCta({ visibility, priceKzt: 99000, offerActive: true, isMember: true, loggedIn: true, access }),
      { kind: 'continue' },
    );
  }
});

test('CTA: бесплатный public → «Начать бесплатно»; гость получает пометку needsLogin', () => {
  const input = { visibility: 'public', priceKzt: null, offerActive: false, isMember: false } as const;
  assert.deepEqual(resolveCourseCta({ ...input, loggedIn: true, access: NONE }), {
    kind: 'start',
    audience: 'free',
    needsLogin: false,
  });
  assert.deepEqual(resolveCourseCta({ ...input, loggedIn: false, access: null }), {
    kind: 'start',
    audience: 'free',
    needsLogin: true,
  });
  // offer с ценой 0 — тоже бесплатный
  assert.equal(resolveCourseCta({ ...input, priceKzt: 0, loggedIn: true, access: NONE }).kind, 'start');
});

test('CTA: internal — «Начать» только члену организации, остальным кнопки нет', () => {
  const input = { visibility: 'internal', priceKzt: null, offerActive: false, loggedIn: true, access: NONE } as const;
  assert.deepEqual(resolveCourseCta({ ...input, isMember: true }), { kind: 'start', audience: 'staff', needsLogin: false });
  assert.deepEqual(resolveCourseCta({ ...input, isMember: false }), { kind: 'unavailable' });
  // internal с ценой самозачисление не даёт, как и canSelfEnroll
  assert.deepEqual(resolveCourseCta({ ...input, priceKzt: 1000, isMember: true }), { kind: 'unavailable' });
});

test('CTA: платный → «Купить»; истёкший доступ → «Продлить»; продажи на паузе → без покупки', () => {
  const input = { visibility: 'public', priceKzt: 99000, offerActive: true, isMember: false, loggedIn: true } as const;
  assert.deepEqual(resolveCourseCta({ ...input, access: NONE }), { kind: 'buy', renew: false });
  assert.deepEqual(resolveCourseCta({ ...input, access: null, loggedIn: false }), { kind: 'buy', renew: false });
  assert.deepEqual(resolveCourseCta({ ...input, access: { ok: false, reason: 'expired' } }), { kind: 'buy', renew: true });
  assert.deepEqual(resolveCourseCta({ ...input, access: { ok: false, reason: 'revoked' } }), { kind: 'buy', renew: false });
  assert.deepEqual(resolveCourseCta({ ...input, offerActive: false, access: NONE }), { kind: 'paused' });
});

test('CTA: private и неизвестная видимость не открываются', () => {
  assert.deepEqual(
    resolveCourseCta({ visibility: 'private', priceKzt: null, offerActive: false, isMember: true, loggedIn: true, access: NONE }),
    { kind: 'unavailable' },
  );
});

// ---------- «Начать бесплатно» ----------

test('startCourse: бесплатный public → зачисление self без организации и срока', async () => {
  const res = await startCourse('guestUser', 'free');
  assert.deepEqual(res, { ok: true, slug: 'free' });
  const e = await getEnrollment('guestUser', 'free');
  assert.equal(e?.source, 'self');
  assert.equal(e?.orgId, null);
  assert.equal(e?.expiresAt, null);
  assert.equal((await canAccessCourse('guestUser', 'free')).ok, true);
  // повторный клик — без ошибки и без дублей
  assert.deepEqual(await startCourse('guestUser', 'free'), { ok: true, slug: 'free' });
  const [n] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM enrollments WHERE user_id = 'guestUser' AND course_id = 'free'`;
  assert.equal(n?.n, 1);
});

test('startCourse: internal своей организации → self с org_id (выход из организации отзовёт доступ)', async () => {
  assert.deepEqual(await startCourse('uA', 'internalA'), { ok: true, slug: 'internalA' });
  const e = await getEnrollment('uA', 'internalA');
  assert.equal(e?.source, 'self');
  assert.equal(e?.orgId, 'orgA');
  await revokeEnrollment('uA', 'internalA', null, undefined, { orgId: 'orgA' });
  assert.equal((await canAccessCourse('uA', 'internalA')).ok, false);
});

test('startCourse: платный курс self не даёт никогда (в том числе при паузе продаж и цене в offer)', async () => {
  assert.deepEqual(await startCourse('uA', 'paid'), { ok: false, error: 'forbidden' });
  assert.deepEqual(await startCourse('uA', 'paused'), { ok: false, error: 'forbidden' });
  assert.equal(await getEnrollment('uA', 'paid'), null);
  assert.equal(await getEnrollment('uA', 'paused'), null);
});

test('startCourse: чужой internal, private, черновик и несуществующий курс — not_found, зачисления нет', async () => {
  for (const [user, slug] of [
    ['uB', 'internalA'],
    ['guestUser', 'internalA'],
    ['uA', 'private'],
    ['uA', 'draft'],
    ['uA', 'draftInternal'],
    ['uA', 'missing'],
  ] as const) {
    assert.deepEqual(await startCourse(user, slug), { ok: false, error: 'not_found' }, `${user} → ${slug}`);
    assert.equal(await getEnrollment(user, slug), null);
  }
});

test('startCourse: уже действующее назначение не затирается (срок и источник сохраняются)', async () => {
  const due = Date.now() + 5 * 86_400_000;
  await enroll({ userId: 'uB', courseId: 'free', source: 'assignment', orgId: 'orgB', grantedBy: 'uA', dueAt: due });
  assert.deepEqual(await startCourse('uB', 'free'), { ok: true, slug: 'free' });
  const e = await getEnrollment('uB', 'free');
  assert.equal(e?.source, 'assignment');
  assert.equal(e?.dueAt, due);
  assert.equal(e?.orgId, 'orgB');
});

test('startCourse: отозванный доступ к бесплатному курсу можно открыть заново', async () => {
  await startCourse('guestUser', 'zero');
  await revokeEnrollment('guestUser', 'zero', null);
  assert.equal((await canAccessCourse('guestUser', 'zero')).ok, false);
  assert.deepEqual(await startCourse('guestUser', 'zero'), { ok: true, slug: 'zero' });
  assert.equal((await canAccessCourse('guestUser', 'zero')).ok, true);
});

// ---------- состояние зрителя ----------

test('getViewerStates: прогресс — доля пройденных опубликованных уроков, срок сдачи и доступ', async () => {
  const due = Date.now() + 3 * 86_400_000;
  await enroll({ userId: 'uA', courseId: 'internalA', source: 'assignment', orgId: 'orgA', dueAt: due });
  await db.sql`INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at)
               VALUES ('uA', 'l-internalA-0', 'internalA', 5)`;
  const list = await listCatalogCourses(['orgA']);
  const states = await getViewerStates('uA', list);
  const s = states.get('internalA');
  assert.equal(s?.access.ok, true);
  assert.equal(s?.dueAt, due);
  assert.equal(s?.source, 'assignment');
  assert.equal(s?.lessonsDone, 1);
  assert.equal(s?.lessonsTotal, 2);
  assert.equal(s?.percent, 50);
  // курсы без зачисления в карту не попадают
  assert.equal(states.has('paid'), false);
  assert.equal((await getViewerStates('guestUser', [])).size, 0);
});

test('getViewerStates: истёкший доступ виден как expired, прогресс сохраняется', async () => {
  await enroll({ userId: 'guestUser', courseId: 'paid', source: 'grant' });
  await db.sql`UPDATE enrollments SET expires_at = ${Date.now() - 1000} WHERE user_id = 'guestUser' AND course_id = 'paid'`;
  await db.sql`INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at)
               VALUES ('guestUser', 'l-paid-0', 'paid', 5)`;
  const paid = await getCourseDetail('paid', []);
  assert.ok(paid);
  const s = (await getViewerStates('guestUser', [paid])).get('paid');
  assert.equal(s?.access.ok, false);
  assert.equal(s?.access.reason, 'expired');
  assert.equal(s?.percent, 100);
  // для платного курса кнопка — «Продлить доступ»
  assert.deepEqual(
    resolveCourseCta({
      visibility: 'public',
      priceKzt: paid.priceKzt,
      offerActive: paid.offerActive,
      isMember: false,
      loggedIn: true,
      access: s?.access ?? NONE,
    }),
    { kind: 'buy', renew: true },
  );
});
