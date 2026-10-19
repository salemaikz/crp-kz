// «Команда»: отчёт руководителя (прогресс, результат теста, срок и статус, сертификат), фильтры, сводка,
// CSV-выгрузка (BOM, разделитель, экранирование) и запись team.export в журнал.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { enroll } from '../../src/lib/access';
import { createTestDb, type TestDb } from '../../src/lib/db/testing';
import { CSV_BOM, csvCell, csvDate, reportToCsv, type CsvLabels } from '../../src/lib/team/csv';
import { exportTeamReport } from '../../src/lib/team/export';
import {
  buildTeamReport,
  filterReport,
  parseStatusFilter,
  rowStatus,
  statusGroup,
  summarize,
} from '../../src/lib/team/report';
import { TeamError, type TeamReportRow } from '../../src/lib/team/types';

let db: TestDb;
const DAY = 86_400_000;
// фиксированный «сегодня» — полдень по Астане; сроки считаются по календарным дням Астаны
const NOW = Date.parse('2026-10-19T12:00:00+05:00');
const at = (days: number) => NOW + days * DAY;

const LABELS: CsvLabels = {
  columns: {
    employee: 'ФИО',
    email: 'Email',
    position: 'Должность',
    course: 'Курс',
    progress: 'Прогресс %',
    test: 'Тест %',
    due: 'Срок',
    status: 'Статус',
    certificate: 'Сертификат',
  },
  status: {
    done: 'Завершено',
    overdue: 'Просрочено',
    today: 'Срок сегодня',
    soon: 'Скоро срок',
    ok: 'В срок',
    nodue: 'Без срока',
    revoked: 'Доступ закрыт',
    expired: 'Доступ закончился',
  },
};

async function user(id: string, name: string, orgId: string, role: 'manager' | 'member' = 'member', position: string | null = null) {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES (${id}, ${id + '@x.kz'}, ${name}, 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, position, created_at)
               VALUES (${orgId}, ${id}, ${role}, ${position}, 1)`;
}

async function assign(userId: string, courseId: string, orgId: string, dueAt: number | null) {
  await enroll({ userId, courseId, source: 'assignment', orgId, grantedBy: 'mgrA', dueAt });
}

async function progress(userId: string, courseId: string, lessonIds: string[]) {
  for (const l of lessonIds) {
    await db.sql`INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at) VALUES (${userId}, ${l}, ${courseId}, 5)`;
  }
}

let attempt = 0;
async function quiz(userId: string, lessonId: string, block: string, correct: number, total: number, passed: boolean) {
  await db.sql`
    INSERT INTO quiz_attempts (id, user_id, lesson_id, block_id, correct, total, passed, created_at)
    VALUES (${`q${++attempt}`}, ${userId}, ${lessonId}, ${block}, ${correct}, ${total}, ${passed}, 5)`;
}

const byUser = (rows: TeamReportRow[], userId: string) => rows.filter((r) => r.userId === userId);

before(async () => {
  db = await createTestDb();
  await db.sql`INSERT INTO organizations (id, slug, name, kind, created_at) VALUES
    ('orgA', 'crp', 'ЦРП', 'owner', 1), ('orgB', 'client', 'Клиент', 'client', 1)`;
  await user('mgrA', 'Руководитель', 'orgA', 'manager');
  await user('mgrB', 'Руководитель Б', 'orgB', 'manager');
  await user('anna', 'Анна Иванова', 'orgA', 'member', 'Оператор');
  await user('boris', 'Борис Ким', 'orgA', 'member', '=cmd|calc');
  await user('vera', 'Вера; "Тест"', 'orgA', 'member', null);
  await user('gleb', 'Глеб Нов', 'orgA', 'member', 'Консультант');
  await user('dina', 'Дина Ос', 'orgA', 'member', 'Консультант');
  await user('ella', 'Элла Ер', 'orgA', 'member', 'Консультант');
  await user('bob', 'Боб из Б', 'orgB', 'member', 'Менеджер');

  await db.sql`INSERT INTO courses (id, slug, title, visibility, owner_org_id, status, created_at, updated_at) VALUES
    ('c1', 'c1', ${db.json({ ru: 'Онбординг', kz: 'Онбординг kz' })}, 'internal', 'orgA', 'published', 1, 1),
    ('c2', 'c2', ${db.json({ ru: 'Регламент' })}, 'internal', 'orgA', 'published', 1, 1),
    ('cB', 'cB', ${db.json({ ru: 'Курс Б' })}, 'internal', 'orgB', 'published', 1, 1)`;
  for (const c of ['c1', 'c2', 'cB']) {
    await db.sql`INSERT INTO course_modules (id, course_id, position, title, created_at) VALUES (${'m-' + c}, ${c}, 0, ${db.json({ ru: 'М' })}, 1)`;
  }
  // c1: 4 опубликованных урока + 1 черновик (в прогресс не входит); c2: 2 урока; cB: 1 урок
  for (const [c, n, extraDraft] of [['c1', 4, true], ['c2', 2, false], ['cB', 1, false]] as const) {
    for (let i = 0; i < n; i++) {
      await db.sql`INSERT INTO lessons (id, course_id, module_id, position, slug, title, status, created_at, updated_at)
                   VALUES (${`${c}-l${i}`}, ${c}, ${'m-' + c}, ${i}, ${'s' + i}, ${db.json({ ru: 'У' })}, 'published', 1, 1)`;
    }
    if (extraDraft) {
      await db.sql`INSERT INTO lessons (id, course_id, module_id, position, slug, title, status, created_at, updated_at)
                   VALUES (${c + '-draft'}, ${c}, ${'m-' + c}, 9, 'draft', ${db.json({ ru: 'Черновик' })}, 'draft', 1, 1)`;
    }
  }

  // anna: c1 — 2 из 4, срок через 10 дней; тесты: блок b1 — две попытки (50 → 100), блок b2 — 60 не сдан
  await assign('anna', 'c1', 'orgA', at(10));
  await progress('anna', 'c1', ['c1-l0', 'c1-l1']);
  await quiz('anna', 'c1-l0', 'b1', 1, 2, false);
  await quiz('anna', 'c1-l0', 'b1', 2, 2, true);
  await quiz('anna', 'c1-l1', 'b2', 3, 5, false);
  // boris: c1 — просрочен (срок 3 дня назад), 0 уроков; ФИО-должность с формулой
  await assign('boris', 'c1', 'orgA', at(-3));
  // vera: c1 — все 4 урока, срок в прошлом, но завершён → «завершено»; сертификат выдан
  await assign('vera', 'c1', 'orgA', at(-1));
  await progress('vera', 'c1', ['c1-l0', 'c1-l1', 'c1-l2', 'c1-l3', 'c1-draft']);
  await db.sql`INSERT INTO certificates (id, number, user_id, course_id, holder_name, locale, issued_at)
               VALUES ('cert1', 'CRP-2026-ABC123', 'vera', 'c1', 'Вера', 'ru', 7)`;
  // gleb: c2 — срок завтра (скоро), 1 из 2; dina: c2 — срок сегодня; ella: c2 — без срока (начала сама)
  await assign('gleb', 'c2', 'orgA', at(1));
  await progress('gleb', 'c2', ['c2-l0']);
  await assign('dina', 'c2', 'orgA', at(0) + 3 * 3_600_000);
  await enroll({ userId: 'ella', courseId: 'c2', source: 'self', orgId: 'orgA' });
  // зачисление без org_id (личное, не назначение) в отчёт не попадает
  await db.sql`INSERT INTO courses (id, slug, title, visibility, status, created_at, updated_at)
               VALUES ('pub', 'pub', ${db.json({ ru: 'Публичный' })}, 'public', 'published', 1, 1)`;
  await enroll({ userId: 'anna', courseId: 'pub', source: 'self' });

  // организация Б: свои сотрудники и курс; не должны попасть в отчёт А
  await assign('bob', 'cB', 'orgB', at(5));
});
after(async () => {
  await db.close();
});

test('отчёт: только зачисления организации и только её сотрудники', async () => {
  const rows = await buildTeamReport('orgA', NOW);
  assert.deepEqual(
    rows.map((r) => `${r.userId}:${r.courseId}`).sort(),
    ['anna:c1', 'boris:c1', 'dina:c2', 'ella:c2', 'gleb:c2', 'vera:c1'],
  );
  assert.equal(rows.some((r) => r.userId === 'bob'), false);
  assert.equal(rows.some((r) => r.courseId === 'pub'), false); // личный доступ без org_id
  const b = await buildTeamReport('orgB', NOW);
  assert.deepEqual(b.map((r) => r.userId), ['bob']);
  assert.deepEqual(await buildTeamReport('nope', NOW), []);
});

test('отчёт: сотрудник, вышедший из организации, пропадает из её отчёта', async () => {
  await db.sql`INSERT INTO users (id, email, name, created_at) VALUES ('leaver', 'l@x.kz', 'Ушёл', 1)`;
  await db.sql`INSERT INTO organization_members (org_id, user_id, role, created_at) VALUES ('orgA', 'leaver', 'member', 1)`;
  await assign('leaver', 'c2', 'orgA', null);
  assert.equal((await buildTeamReport('orgA', NOW)).some((r) => r.userId === 'leaver'), true);
  await db.sql`DELETE FROM organization_members WHERE user_id = 'leaver'`;
  assert.equal((await buildTeamReport('orgA', NOW)).some((r) => r.userId === 'leaver'), false);
});

test('прогресс: доля пройденных опубликованных уроков; черновики не считаются', async () => {
  const rows = await buildTeamReport('orgA', NOW);
  const anna = byUser(rows, 'anna')[0];
  assert.equal(anna?.lessonsDone, 2);
  assert.equal(anna?.lessonsTotal, 4);
  assert.equal(anna?.progress, 50);
  const vera = byUser(rows, 'vera')[0];
  assert.equal(vera?.lessonsDone, 4); // черновой урок в прогрессе не учтён
  assert.equal(vera?.progress, 100);
  assert.equal(byUser(rows, 'boris')[0]?.progress, 0);
  assert.equal(byUser(rows, 'gleb')[0]?.progress, 50);
});

test('результат теста: среднее из лучших попыток по каждому тесту; нет попыток — null', async () => {
  const rows = await buildTeamReport('orgA', NOW);
  const anna = byUser(rows, 'anna')[0];
  // b1: лучшая 100, b2: 60 → среднее 80; сдан один из двух
  assert.equal(anna?.quizScore, 80);
  assert.equal(anna?.quizzesAttempted, 2);
  assert.equal(anna?.quizzesPassed, 1);
  assert.equal(byUser(rows, 'boris')[0]?.quizScore, null);
  assert.equal(byUser(rows, 'boris')[0]?.quizzesAttempted, 0);
});

test('статусы: завершено, просрочено, срок сегодня, скоро, в срок, без срока', async () => {
  const rows = await buildTeamReport('orgA', NOW);
  const st = (u: string) => byUser(rows, u)[0]?.status;
  assert.equal(st('vera'), 'done'); // срок прошёл, но курс завершён
  assert.equal(st('boris'), 'overdue');
  assert.equal(st('dina'), 'today');
  assert.equal(st('gleb'), 'soon');
  assert.equal(st('anna'), 'ok');
  assert.equal(st('ella'), 'nodue');
  assert.equal(byUser(rows, 'ella')[0]?.dueAt, null);
});

test('сертификат: номер в строке завершённого курса', async () => {
  const rows = await buildTeamReport('orgA', NOW);
  assert.equal(byUser(rows, 'vera')[0]?.certificate?.number, 'CRP-2026-ABC123');
  assert.equal(byUser(rows, 'anna')[0]?.certificate, null);
});

test('rowStatus: отозванный и истёкший доступ; завершённый курс остаётся «завершён»', () => {
  const base = { completed: false, dueAt: at(5), revokedAt: null, expiresAt: null };
  assert.equal(rowStatus({ ...base, revokedAt: 1 }, NOW), 'revoked');
  assert.equal(rowStatus({ ...base, expiresAt: NOW - 1 }, NOW), 'expired');
  assert.equal(rowStatus({ ...base, expiresAt: NOW + DAY }, NOW), 'ok');
  assert.equal(rowStatus({ ...base, completed: true, revokedAt: 1 }, NOW), 'done');
  assert.equal(rowStatus({ ...base, dueAt: null }, NOW), 'nodue');
  assert.equal(rowStatus({ ...base, dueAt: at(-1) }, NOW), 'overdue');
  assert.equal(rowStatus({ ...base, dueAt: at(3) }, NOW), 'soon');
  assert.equal(rowStatus({ ...base, dueAt: at(4) }, NOW), 'ok');
});

test('отозванное назначение остаётся в отчёте со статусом «доступ закрыт»', async () => {
  await db.sql`UPDATE enrollments SET revoked_at = ${NOW} WHERE user_id = 'ella' AND course_id = 'c2'`;
  const rows = await buildTeamReport('orgA', NOW);
  assert.equal(byUser(rows, 'ella')[0]?.status, 'revoked');
  await db.sql`UPDATE enrollments SET revoked_at = NULL WHERE user_id = 'ella' AND course_id = 'c2'`;
});

test('фильтры отчёта: по курсу и по группе статусов', async () => {
  const rows = await buildTeamReport('orgA', NOW);
  const ids = (list: TeamReportRow[]) => list.map((r) => r.userId).sort();
  assert.deepEqual(ids(filterReport(rows, { courseId: 'c2' })), ['dina', 'ella', 'gleb']);
  assert.deepEqual(ids(filterReport(rows, { status: 'overdue' })), ['boris']);
  assert.deepEqual(ids(filterReport(rows, { status: 'soon' })), ['dina', 'gleb']); // сегодня + скоро
  assert.deepEqual(ids(filterReport(rows, { status: 'done' })), ['vera']);
  assert.deepEqual(ids(filterReport(rows, { status: 'active' })), ['anna', 'ella']);
  assert.deepEqual(ids(filterReport(rows, { courseId: 'c1', status: 'active' })), ['anna']);
  assert.deepEqual(filterReport(rows, { status: 'inactive' }), []);
  assert.equal(filterReport(rows, {}).length, rows.length);
  assert.equal(statusGroup('nodue'), 'active');
  assert.equal(statusGroup('expired'), 'inactive');
  assert.equal(parseStatusFilter('overdue'), 'overdue');
  assert.equal(parseStatusFilter('x'), null);
  assert.equal(parseStatusFilter(['done', 'soon']), 'done');
});

test('сводка: сотрудники, в работе, просрочено, доля завершивших', async () => {
  const rows = await buildTeamReport('orgA', NOW);
  const s = summarize(rows, 8);
  assert.equal(s.employees, 8);
  assert.equal(s.done, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.active, 5); // всё, кроме завершённого (vera)
  assert.equal(s.counted, 6);
  assert.equal(s.completionPercent, 17);
  assert.equal(summarize([], 3).completionPercent, null);
  // закрытый доступ в процент не входит
  const closed = rows.map((r) => (r.userId === 'ella' ? { ...r, status: 'revoked' as const } : r));
  assert.equal(summarize(closed, 8).counted, 5);
});

// ---------- CSV ----------

test('csvCell: кавычки, «;», переводы строк и защита от формул Excel', () => {
  assert.equal(csvCell('Анна'), 'Анна');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(85), '85');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+7 701'), "'+7 701");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('=1;2'), `"'=1;2"`);
  assert.equal(csvCell(-5), '-5'); // число — не строка, не трогаем
});

test('CSV: BOM, разделитель «;», CRLF, колонки и строки как в отчёте', async () => {
  const rows = filterReport(await buildTeamReport('orgA', NOW), { courseId: 'c1' });
  const csv = reportToCsv(rows, LABELS, 'ru');
  assert.ok(csv.startsWith(CSV_BOM), 'UTF-8 BOM для Excel');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.pop(), ''); // завершающий CRLF
  assert.equal(lines[0], 'ФИО;Email;Должность;Курс;Прогресс %;Тест %;Срок;Статус;Сертификат');
  assert.equal(lines.length, 1 + 3); // шапка + anna, boris, vera
  const anna = lines.find((l) => l.startsWith('Анна Иванова;'));
  assert.equal(anna, `Анна Иванова;anna@x.kz;Оператор;Онбординг;50;80;${csvDate(at(10))};В срок;`);
  // формула в должности нейтрализована, спецсимволы в ФИО экранированы
  const boris = lines.find((l) => l.startsWith('Борис Ким;'));
  assert.equal(boris, `Борис Ким;boris@x.kz;'=cmd|calc;Онбординг;0;;${csvDate(at(-3))};Просрочено;`);
  const vera = lines.find((l) => l.includes('vera@x.kz'));
  assert.equal(vera, `"Вера; ""Тест""";vera@x.kz;;Онбординг;100;;${csvDate(at(-1))};Завершено;CRP-2026-ABC123`);
  // название курса — на языке отчёта: kz есть у «Онбординг»
  assert.ok(reportToCsv(rows, LABELS, 'kz').includes('Онбординг kz'));
});

test('csvDate: дд.мм.гггг по Астане', () => {
  assert.equal(csvDate(Date.parse('2026-10-25T23:59:59+05:00')), '25.10.2026');
  assert.equal(csvDate(Date.parse('2026-01-05T00:30:00+05:00')), '05.01.2026');
});

// ---------- выгрузка и журнал ----------

test('exportTeamReport: руководитель получает CSV своей организации и запись team.export', async () => {
  const res = await exportTeamReport({ actorId: 'mgrA', orgId: 'orgA', locale: 'ru', labels: LABELS, nowMs: NOW });
  assert.ok(res.csv.startsWith(CSV_BOM));
  assert.equal(res.rows, 6);
  assert.ok(res.csv.includes('anna@x.kz'));
  assert.equal(res.csv.includes('bob@x.kz'), false, 'сотрудники другой организации не выгружаются');
  const [log] = await db.sql<{ actorId: string; entity: string; entityId: string; meta: { rows: number; status: string | null } }>`
    SELECT actor_id, entity, entity_id, meta FROM audit_log WHERE action = 'team.export' ORDER BY created_at DESC LIMIT 1`;
  assert.equal(log?.actorId, 'mgrA');
  assert.equal(log?.entity, 'org');
  assert.equal(log?.entityId, 'orgA');
  assert.equal(log?.meta.rows, 6);
});

test('exportTeamReport: фильтры применяются так же, как в интерфейсе', async () => {
  const res = await exportTeamReport({
    actorId: 'mgrA',
    orgId: 'orgA',
    locale: 'ru',
    labels: LABELS,
    nowMs: NOW,
    filters: { status: 'overdue' },
  });
  assert.equal(res.rows, 1);
  assert.ok(res.csv.includes('boris@x.kz'));
  assert.equal(res.csv.includes('anna@x.kz'), false);
});

test('exportTeamReport: не руководитель (сотрудник, чужой руководитель, гость) не получает файл и не пишет в журнал', async () => {
  const [before] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM audit_log WHERE action = 'team.export'`;
  for (const actorId of ['anna', 'mgrB', 'bob', 'ghost']) {
    await assert.rejects(
      exportTeamReport({ actorId, orgId: 'orgA', locale: 'ru', labels: LABELS, nowMs: NOW }),
      (e: unknown) => e instanceof TeamError && e.code === 'forbidden',
      actorId,
    );
  }
  const [after] = await db.sql<{ n: number }>`SELECT count(*) AS n FROM audit_log WHERE action = 'team.export'`;
  assert.equal(after?.n, before?.n);
  // руководитель Б выгружает только свою организацию
  const own = await exportTeamReport({ actorId: 'mgrB', orgId: 'orgB', locale: 'ru', labels: LABELS, nowMs: NOW });
  assert.equal(own.rows, 1);
  assert.ok(own.csv.includes('bob@x.kz'));
  assert.equal(own.csv.includes('anna@x.kz'), false);
});
