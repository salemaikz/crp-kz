// zod-схемы входных данных админки. Принимают «сырые» значения из форм (строки) и из кода (числа).
// Сообщения ошибок — стабильные коды: UI переводит их через errors.field.<код>.
import { z } from 'zod';
import { AdminError, type FieldErrors } from './errors';
import { SLUG_MAX, SLUG_RE } from './slug';

/** Коды, которые задаём сами в схемах (остальные сообщения zod заменяются кодом по типу проблемы). */
const KNOWN_CODES = new Set([
  'required',
  'tooLong',
  'tooSmall',
  'tooBig',
  'notNumber',
  'notInteger',
  'invalid',
  'slugFormat',
  'ownerRequired',
]);

function codeFor(issue: z.ZodIssue): string {
  if (KNOWN_CODES.has(issue.message)) return issue.message;
  switch (issue.code) {
    case 'too_small':
      return issue.type === 'string' ? 'required' : 'tooSmall';
    case 'too_big':
      return issue.type === 'string' ? 'tooLong' : 'tooBig';
    case 'invalid_type':
      if (issue.received === 'undefined') return 'required';
      return issue.received === 'nan' ? 'notNumber' : 'invalid';
    default:
      return 'invalid';
  }
}

/** Ошибки по полям: берём первую проблему каждого поля (по первому элементу пути). */
export function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!(key in out)) out[key] = codeFor(issue);
  }
  return out;
}

/** safeParse с превращением ошибки в AdminError('VALIDATION', fields). */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const res = schema.safeParse(raw);
  if (!res.success) throw new AdminError('VALIDATION', fieldErrorsFromZod(res.error));
  return res.data as z.output<S>;
}

// ---------- строительные блоки ----------

const blankToUndefined = (v: unknown): unknown => (v == null || (typeof v === 'string' && v.trim() === '') ? undefined : v);

/** Необязательный текст: отсутствие/null → ''. */
export const optText = (max: number) =>
  z.preprocess((v) => (v == null ? '' : v), z.string({ invalid_type_error: 'invalid' }).trim().max(max, 'tooLong'));

/** Обязательный текст: пустая строка после trim — ошибка required. */
export const reqText = (max: number) =>
  z.preprocess(
    (v) => (v == null ? '' : v),
    z.string({ invalid_type_error: 'invalid' }).trim().min(1, 'required').max(max, 'tooLong'),
  );

/** Целое: '' и отсутствие → undefined; строки с пробелами («99 000») разбираются. */
const intRaw = (min: number, max: number) =>
  z.preprocess((v) => {
    const b = blankToUndefined(v);
    if (typeof b === 'string') return Number(b.replace(/\s/g, '')); // \s включает и неразрывные пробелы
    return b;
  }, z.number({ invalid_type_error: 'notNumber' }).int('notInteger').min(min, 'tooSmall').max(max, 'tooBig').optional());

/** Целое с значением по умолчанию. */
export const intOr = (min: number, max: number, fallback: number) =>
  intRaw(min, max).transform((v): number => v ?? fallback);

/** Целое или null (пусто → null). */
export const intOrNull = (min: number, max: number) => intRaw(min, max).transform((v): number | null => v ?? null);

export const boolField = z.preprocess(
  (v) => v === true || v === 'on' || v === 'true' || v === '1',
  z.boolean(),
);

const enumField = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values as unknown as [T[number], ...T[number][]], { errorMap: () => ({ message: 'invalid' }) });

/** Пустая строка → null. */
const nullableId = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string({ invalid_type_error: 'invalid' }).trim().max(64, 'tooLong').nullable().default(null),
);

const slugField = z.preprocess(
  (v) => (v == null ? '' : v),
  z
    .string({ invalid_type_error: 'invalid' })
    .trim()
    .toLowerCase()
    .max(SLUG_MAX, 'tooLong')
    .refine((s) => s === '' || SLUG_RE.test(s), 'slugFormat'),
);

// ---------- курс ----------

export const COURSE_LEVELS = ['start', 'base', 'pro'] as const;
export const COURSE_VISIBILITIES = ['public', 'internal', 'private'] as const;
export const PUBLISH_STATUSES = ['draft', 'published'] as const;
export const USER_ROLES = ['learner', 'author', 'admin'] as const;

export const courseInputSchema = z
  .object({
    titleRu: reqText(200),
    titleKz: optText(200),
    summaryRu: optText(600),
    summaryKz: optText(600),
    descriptionRu: optText(20_000),
    descriptionKz: optText(20_000),
    /** Пусто — адрес строится из названия (при создании) или остаётся прежним (при правке). */
    slug: slugField,
    level: z.preprocess(
      (v) => (v === '' || v == null ? null : v),
      z.enum(COURSE_LEVELS, { errorMap: () => ({ message: 'invalid' }) }).nullable(),
    ),
    durationMin: intOr(0, 100_000, 0),
    visibility: enumField(COURSE_VISIBILITIES).default('public'),
    ownerOrgId: nullableId,
    sequential: boolField.default(false),
    status: enumField(PUBLISH_STATUSES).default('draft'),
    /** 0 или пусто — бесплатный курс (активного предложения нет). */
    priceKzt: intOr(0, 100_000_000, 0),
    /** Срок доступа в днях; пусто — бессрочно. Для бесплатных курсов не используется. */
    accessDays: intOrNull(1, 3650),
  })
  .superRefine((v, ctx) => {
    if (v.visibility === 'internal' && !v.ownerOrgId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerOrgId'], message: 'ownerRequired' });
    }
  });

export type CourseInput = z.output<typeof courseInputSchema>;

// ---------- модуль и урок ----------

export const moduleInputSchema = z.object({
  titleRu: reqText(200),
  titleKz: optText(200),
});

export const lessonCreateSchema = z.object({
  titleRu: reqText(200),
  titleKz: optText(200),
  durationMin: intOr(0, 1000, 0),
});

export const lessonMetaSchema = z.object({
  titleRu: reqText(200),
  titleKz: optText(200),
  /** Пусто — адрес не меняется. */
  slug: slugField,
  durationMin: intOr(0, 1000, 0),
  /** Не передан — статус урока не меняется. */
  status: enumField(PUBLISH_STATUSES).optional(),
});

export const directionSchema = z.enum(['up', 'down']);
export type Direction = z.infer<typeof directionSchema>;

// ---------- пользователи ----------

export const grantSchema = z.object({
  userId: z.string().min(1, 'required').max(64),
  courseId: z.string().min(1, 'required').max(64),
  /** Срок доступа в днях; пусто — бессрочно. */
  accessDays: intOrNull(1, 3650),
});

export const roleSchema = z.object({
  userId: z.string().min(1, 'required').max(64),
  role: enumField(USER_ROLES),
});

/** L10n для хранения в jsonb: пустой kz не пишем. */
export function toL10n(ru: string, kz: string): { ru: string; kz?: string } {
  return kz ? { ru, kz } : { ru };
}

/** L10n для необязательных полей (summary, description): пусто → {}. */
export function toOptionalL10n(ru: string, kz: string): { ru?: string; kz?: string } {
  if (!ru && !kz) return {};
  return kz ? { ru, kz } : { ru };
}
