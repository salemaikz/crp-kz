// Сид: назначения, покупки, прогресс, заказы, сертификат и журнал. Всё детерминировано от базы.
import { createHash } from 'node:crypto';
import { seedId } from '../../content/ids';
import type { Sql } from '../core';
import { isFreeCourse, type SeededCourse, type SeededLesson } from './courses';
import { demoEmail, SEED_BUYERS, SEED_PEOPLE, seedOrgId, seedUserId } from './people';
import { DAY, HOUR } from './time';

type Ctx = { sql: Sql; json: (v: unknown) => unknown; base: number };

const CONSENT_VERSION = '2026-10-19';
const CERT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Курсы сида по ролям в сценарии (по видимости/цене, «Целина» — по названию). */
export function pickSeedRoles(seeded: readonly SeededCourse[]) {
  const internal = seeded.find((s) => s.course.visibility === 'internal' && s.course.ownerOrg === 'crp');
  const paid = seeded.filter((s) => s.course.visibility === 'public' && !isFreeCourse(s.course));
  const tselina = paid.find((s) => /целин/i.test(s.course.title.ru)) ?? paid[0];
  const sales = paid.find((s) => s !== tselina) ?? tselina;
  const free = seeded.find((s) => s.course.visibility === 'public' && isFreeCourse(s.course));
  return { internal, tselina, sales, free };
}

/** Номер сертификата сида: CRP-<год>-<6 символов>, детерминированный. */
export function seedCertificateNumber(key: string, issuedAt: number): string {
  const h = createHash('sha1').update(`cert:${key}`).digest();
  let code = '';
  for (let i = 0; i < 6; i++) code += CERT_ALPHABET[(h[i] as number) % CERT_ALPHABET.length];
  return `CRP-${new Date(issuedAt).getUTCFullYear()}-${code}`;
}

async function audit(
  ctx: Ctx,
  key: string,
  a: { actorId: string | null; action: string; entity: string; entityId: string; meta: object; at: number },
) {
  await ctx.sql`
    INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at)
    VALUES (${seedId('audit', key)}, ${a.actorId}, ${a.action}, ${a.entity}, ${a.entityId}, ${ctx.json(a.meta)}, ${a.at})`;
}

async function enrollment(
  ctx: Ctx,
  e: {
    userId: string;
    courseId: string;
    source: 'purchase' | 'assignment' | 'self';
    orgId?: string;
    orderId?: string;
    grantedBy?: string;
    dueAt?: number;
    expiresAt?: number;
    at: number;
  },
): Promise<string> {
  const id = seedId('enrollment', `${e.userId}:${e.courseId}`);
  await ctx.sql`
    INSERT INTO enrollments (id, user_id, course_id, source, org_id, order_id, granted_by, due_at, expires_at,
                             revoked_at, created_at, updated_at)
    VALUES (${id}, ${e.userId}, ${e.courseId}, ${e.source}, ${e.orgId ?? null}, ${e.orderId ?? null},
            ${e.grantedBy ?? null}, ${e.dueAt ?? null}, ${e.expiresAt ?? null}, NULL, ${e.at}, ${e.at})`;
  await audit(ctx, `grant:${id}`, {
    actorId: e.grantedBy ?? e.userId,
    action: 'enrollment.grant',
    entity: 'enrollment',
    entityId: id,
    meta: { source: e.source, courseId: e.courseId, userId: e.userId, orderId: e.orderId ?? null },
    at: e.at,
  });
  return id;
}

/** Первые count уроков курса пройдены; тесты в них сданы. Возвращает время последнего урока. */
async function progress(
  ctx: Ctx,
  userId: string,
  courseId: string,
  lessons: readonly SeededLesson[],
  count: number,
  startAt: number,
  opts: { failFirstQuiz?: boolean } = {},
): Promise<number> {
  let t = startAt;
  let needFail = Boolean(opts.failFirstQuiz);
  for (const l of lessons.slice(0, count)) {
    t += 7 * HOUR;
    for (const q of l.quizzes) {
      if (needFail) {
        // одна неудачная попытка — для правдоподобной истории тестов
        const wrong = Math.floor(q.total / 3);
        await ctx.sql`
          INSERT INTO quiz_attempts (id, user_id, lesson_id, block_id, correct, total, passed, created_at)
          VALUES (${seedId('quiz', `${userId}:${l.id}:${q.blockId}:1`)}, ${userId}, ${l.id}, ${q.blockId},
                  ${wrong}, ${q.total}, ${(wrong / q.total) * 100 >= q.passScore}, ${t - 20 * 60_000})`;
        needFail = false;
      }
      await ctx.sql`
        INSERT INTO quiz_attempts (id, user_id, lesson_id, block_id, correct, total, passed, created_at)
        VALUES (${seedId('quiz', `${userId}:${l.id}:${q.blockId}:2`)}, ${userId}, ${l.id}, ${q.blockId},
                ${q.total}, ${q.total}, true, ${t - 5 * 60_000})`;
    }
    await ctx.sql`
      INSERT INTO lesson_progress (user_id, lesson_id, course_id, completed_at)
      VALUES (${userId}, ${l.id}, ${courseId}, ${t})`;
  }
  return t;
}

async function consent(ctx: Ctx, key: string, c: { userId?: string; orderId?: string; at: number }) {
  await ctx.sql`
    INSERT INTO consents (id, user_id, order_id, kind, version, created_at)
    VALUES (${seedId('consent', key)}, ${c.userId ?? null}, ${c.orderId ?? null}, 'pd_processing',
            ${CONSENT_VERSION}, ${c.at})`;
}

type SeedOrder = {
  number: string;
  courseId: string;
  amountKzt: number;
  /** Срок доступа из предложения курса на момент заказа (снимок, D-020). */
  accessDays: number | null;
  status: 'pending' | 'paid';
  buyerType: 'person' | 'company';
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  companyName?: string;
  companyBin?: string;
  paymentMethod: 'kaspi' | 'invoice';
  /** Владелец заказа — всегда аккаунт (D-020). */
  userId: string;
  paidAt?: number;
  decidedBy?: string;
  at: number;
};

async function order(ctx: Ctx, o: SeedOrder): Promise<string> {
  const id = seedId('order', o.number);
  await ctx.sql`
    INSERT INTO orders (id, number, user_id, course_id, amount_kzt, access_days, status, buyer_type, buyer_name,
                        buyer_email, buyer_phone, company_name, company_bin, payment_method, paid_at, decided_by,
                        created_at, updated_at)
    VALUES (${id}, ${o.number}, ${o.userId}, ${o.courseId}, ${o.amountKzt}, ${o.accessDays}, ${o.status}, ${o.buyerType},
            ${o.buyerName}, ${o.buyerEmail}, ${o.buyerPhone}, ${o.companyName ?? null}, ${o.companyBin ?? null},
            ${o.paymentMethod}, ${o.paidAt ?? null}, ${o.decidedBy ?? null}, ${o.at}, ${o.paidAt ?? o.at})`;
  await consent(ctx, `order:${o.number}`, { userId: o.userId, orderId: id, at: o.at });
  await audit(ctx, `order.create:${o.number}`, {
    actorId: o.userId ?? null,
    action: 'order.create',
    entity: 'order',
    entityId: id,
    meta: { number: o.number, amountKzt: o.amountKzt, paymentMethod: o.paymentMethod },
    at: o.at,
  });
  if (o.status === 'paid' && o.paidAt) {
    await audit(ctx, `order.paid:${o.number}`, {
      actorId: o.decidedBy ?? null,
      action: 'order.paid',
      entity: 'order',
      entityId: id,
      meta: { number: o.number, amountKzt: o.amountKzt },
      at: o.paidAt,
    });
  }
  return id;
}

export async function seedActivity(ctx: Ctx, seeded: readonly SeededCourse[]): Promise<void> {
  const { base } = ctx;
  const roles = pickSeedRoles(seeded);
  const orgId = seedOrgId();
  const adminId = seedUserId(demoEmail('admin'));
  const managerId = seedUserId(demoEmail('manager'));
  const clientEmail = demoEmail('client');
  const clientId = seedUserId(clientEmail);
  const client = SEED_PEOPLE.find((p) => p.email === clientEmail);

  // Назначения внутреннего курса сотрудникам: сроки в прошлом и будущем, разный прогресс
  if (roles.internal) {
    const { course, lessons } = roles.internal;
    for (const [i, p] of SEED_PEOPLE.entries()) {
      if (!p.assignment) continue;
      const userId = seedUserId(p.email);
      const at = base - 14 * DAY + 9 * HOUR + i * 10 * 60_000;
      await enrollment(ctx, {
        userId,
        courseId: course.id,
        source: 'assignment',
        orgId,
        grantedBy: managerId,
        dueAt: base + p.assignment.dueInDays * DAY + 18 * HOUR,
        at,
      });
      const done = Math.round(lessons.length * p.assignment.progress);
      await progress(ctx, userId, course.id, lessons, done, at + DAY);
    }
  }

  // Клиент купил «Целину»: оплаченный заказ, зачисление purchase, пройдена часть
  if (roles.tselina) {
    const { course, lessons } = roles.tselina;
    const createdAt = base - 21 * DAY + 11 * HOUR;
    const paidAt = base - 20 * DAY + 10 * HOUR;
    const orderId = await order(ctx, {
      number: 'DEMO-1001',
      courseId: course.id,
      amountKzt: course.priceKzt ?? 0,
      accessDays: course.accessDays ?? null,
      status: 'paid',
      buyerType: 'person',
      buyerName: client?.name ?? 'Клиент',
      buyerEmail: clientEmail,
      buyerPhone: '+7 700 000 00 10',
      paymentMethod: 'kaspi',
      userId: clientId,
      paidAt,
      decidedBy: adminId,
      at: createdAt,
    });
    await enrollment(ctx, {
      userId: clientId,
      courseId: course.id,
      source: 'purchase',
      orderId,
      grantedBy: adminId,
      expiresAt: course.accessDays ? paidAt + course.accessDays * DAY : undefined,
      at: paidAt,
    });
    const done = Math.min(lessons.length - 1, Math.max(2, Math.round(lessons.length / 4)));
    await progress(ctx, clientId, course.id, lessons, done, paidAt, { failFirstQuiz: true });
  }

  // Бесплатный курс пройден полностью, сертификат выдан
  if (roles.free) {
    const { course, lessons } = roles.free;
    const at = base - 30 * DAY + 15 * HOUR;
    await enrollment(ctx, { userId: clientId, courseId: course.id, source: 'self', at });
    const last = await progress(ctx, clientId, course.id, lessons, lessons.length, at);
    const issuedAt = last + 60_000;
    const certId = seedId('certificate', `${clientId}:${course.id}`);
    await ctx.sql`
      INSERT INTO certificates (id, number, user_id, course_id, holder_name, locale, issued_at)
      VALUES (${certId}, ${seedCertificateNumber(`${clientId}:${course.id}`, issuedAt)}, ${clientId}, ${course.id},
              ${client?.name ?? 'Клиент'}, 'ru', ${issuedAt})`;
    await audit(ctx, `cert:${certId}`, {
      actorId: clientId,
      action: 'certificate.issue',
      entity: 'certificate',
      entityId: certId,
      meta: { courseId: course.id },
      at: issuedAt,
    });
  }

  // Согласие клиента на обработку ПДн при регистрации
  await consent(ctx, `user:${clientEmail}`, { userId: clientId, at: base - 40 * DAY });

  // Ожидающие заказы: физлицо Kaspi и юрлицо по счёту (покупатели вымышленные)
  if (roles.sales) {
    await order(ctx, {
      number: 'DEMO-1002',
      courseId: roles.sales.course.id,
      amountKzt: roles.sales.course.priceKzt ?? 0,
      accessDays: roles.sales.course.accessDays ?? null,
      status: 'pending',
      buyerType: 'person',
      buyerName: SEED_BUYERS.person.name,
      buyerEmail: SEED_BUYERS.person.email,
      buyerPhone: '+7 700 000 00 01',
      paymentMethod: 'kaspi',
      userId: seedUserId(SEED_BUYERS.person.email),
      at: base - DAY + 16 * HOUR,
    });
  }
  if (roles.tselina) {
    await order(ctx, {
      number: 'DEMO-1003',
      courseId: roles.tselina.course.id,
      amountKzt: roles.tselina.course.priceKzt ?? 0,
      accessDays: roles.tselina.course.accessDays ?? null,
      status: 'pending',
      buyerType: 'company',
      buyerName: SEED_BUYERS.company.name,
      buyerEmail: SEED_BUYERS.company.email,
      buyerPhone: '+7 700 000 00 02',
      companyName: 'ТОО «Дала Трейд» (демо)',
      companyBin: '123456789012',
      paymentMethod: 'invoice',
      userId: seedUserId(SEED_BUYERS.company.email),
      at: base - 2 * DAY + 12 * HOUR,
    });
  }
}
