// HTTP-слой загрузки и выдачи: Request → Response с внедряемыми зависимостями, тестируется без Next.
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { safeNext } from '../auth/safeNext';
import { getDb } from '../db';
import { isFeatureActive } from '../features';
import { getStorage, StorageUnavailableError } from '../storage';
import { contentDisposition } from '../storage/names';
import type { StorageObject } from '../storage/types';
import { canReadFile, type FileReadDecision } from './access';
import { allowDownload } from './limits';
import { storeUpload } from './store';
import { UploadError, type FileRow, type UploadErrorCode, type UploadPurpose } from './types';
import { isUuid } from './url';

type Viewer = { id: string; role: string };

export type HttpDeps = {
  getUser: () => Promise<Viewer | null>;
  clientIp: (h: Headers) => string | null;
  /** Подмена источников данных в unit-тестах заголовков. */
  source?: {
    findFile(id: string): Promise<FileRow | null>;
    canRead(user: Viewer | null, file: FileRow): Promise<FileReadDecision>;
    open(file: FileRow): Promise<StorageObject | null>;
  };
};

/** Заголовки каждого ответа обоих маршрутов: тип не угадывается, документ не исполняется на нашем origin. */
const SECURE: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
};

// ---------- загрузка ----------

const NAME_HEADER_MAX = 1024;

function uploadJson(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURE, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function uploadFail(code: UploadErrorCode, status: number, params?: Record<string, string | number>): Response {
  return uploadJson({ ok: false, error: code, ...(params ? { params } : {}) }, status);
}

/** Вторая линия поверх cookie sameSite=lax: запрос должен прийти с нашего origin. */
function sameOrigin(h: Headers): boolean {
  const site = h.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = h.get('origin');
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const own = (h.get('x-forwarded-host')?.split(',')[0] ?? h.get('host') ?? '').trim().toLowerCase();
  return own !== '' && host === own;
}

/** X-Upload-Name: encodeURIComponent(имя), только ASCII, до 1024 символов. null — заголовок некорректен. */
function decodeUploadName(raw: string | null): string | null {
  if (!raw || raw.length > NAME_HEADER_MAX || !/^[\x21-\x7E]+$/.test(raw)) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export async function handleUpload(req: Request, deps: HttpDeps): Promise<Response> {
  // выключено: 404 до чтения тела и проверки сессии
  if (!isFeatureActive('UPLOADS')) return uploadFail('disabled', 404);
  if (!sameOrigin(req.headers)) return uploadFail('cross_site', 403);

  const url = new URL(req.url);
  const purpose = url.searchParams.get('purpose');
  const courseId = url.searchParams.get('courseId');
  const lessonId = url.searchParams.get('lessonId');
  if (purpose !== 'lesson_material' && purpose !== 'course_cover') return uploadFail('bad_request', 400);
  if (!courseId) return uploadFail('not_found', 404);

  if (!/^application\/octet-stream\s*(;|$)/i.test(req.headers.get('content-type') ?? '')) return uploadFail('bad_request', 400);
  const name = decodeUploadName(req.headers.get('x-upload-name'));
  if (name === null) return uploadFail('bad_request', 400);
  const lengthRaw = req.headers.get('content-length');
  if (lengthRaw === null) return uploadFail('length_required', 411);
  if (!/^\d{1,15}$/.test(lengthRaw)) return uploadFail('bad_request', 400);

  const user = await deps.getUser();
  if (!user) return uploadFail('forbidden', 403);
  if (!req.body) return uploadFail('bad_request', 400);

  try {
    const file = await storeUpload({
      actor: user,
      purpose: purpose as UploadPurpose,
      courseId,
      lessonId,
      name,
      declaredSize: Number(lengthRaw),
      body: Readable.fromWeb(req.body as unknown as NodeWebStream<Uint8Array>) as AsyncIterable<Uint8Array>,
    });
    return uploadJson({ ok: true, file }, 201);
  } catch (e) {
    if (e instanceof UploadError) return uploadFail(e.code, e.status, e.params);
    // в лог — только класс ошибки: текст может содержать пути и имена
    console.error('[files] ошибка загрузки', e instanceof Error ? e.name : typeof e);
    return uploadFail('storage_unavailable', 500);
  }
}

// ---------- выдача ----------

const text = (body: string, status: number, extra: Record<string, string> = {}): Response =>
  new Response(body, {
    status,
    headers: { ...SECURE, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

function cookieLocale(h: Headers): 'ru' | 'kz' {
  const m = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(h.get('cookie') ?? '');
  return m?.[1] === 'kz' ? 'kz' : 'ru';
}

/** Гость → вход с возвратом на файл, вошедший → 404. Существование файла не раскрывается. */
function denied(req: Request, id: string, user: Viewer | null): Response {
  if (user) return text('Not found', 404);
  const next = safeNext(`/api/files/${id}`) ?? '/';
  return new Response(null, {
    status: 302,
    headers: { ...SECURE, 'Cache-Control': 'no-store', Location: `/${cookieLocale(req.headers)}/login?next=${encodeURIComponent(next)}` },
  });
}

function etagMatches(header: string | null, sha256: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const v = t.trim().replace(/^W\//, '');
    return v === '*' || v === `"${sha256}"`;
  });
}

let storageWarned = false;

const defaultSource: NonNullable<HttpDeps['source']> = {
  async findFile(id) {
    const db = await getDb();
    const [row] = await db.sql<FileRow>`SELECT * FROM files WHERE id = ${id}`;
    return row ?? null;
  },
  canRead: canReadFile,
  async open(file) {
    try {
      return await getStorage().open(file.storageKey);
    } catch (e) {
      if (!(e instanceof StorageUnavailableError)) throw e;
      if (!storageWarned) {
        storageWarned = true;
        console.error('[files] хранилище недоступно:', e.reason);
      }
      return null;
    }
  },
};

export async function handleDownload(req: Request, rawId: string, deps: HttpDeps): Promise<Response> {
  if (!isFeatureActive('UPLOADS')) return text('Not found', 404); // аварийный выключатель, в том числе для админа
  const source = deps.source ?? defaultSource;
  const user = await deps.getUser();

  const limit = allowDownload(user ? { userId: user.id } : { ip: deps.clientIp(req.headers) ?? 'unknown' });
  if (!limit.ok) return text('Too many requests', 429, { 'Retry-After': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) });

  const id = rawId.toLowerCase();
  if (!isUuid(id)) return denied(req, rawId, user);
  const file = await source.findFile(id);
  if (!file) return denied(req, id, user);
  const decision = await source.canRead(user, file);
  if (!decision.ok) return denied(req, id, user);

  const cacheControl = decision.cache === 'public' ? 'public, max-age=86400' : 'private, no-cache';
  const etag = `"${file.sha256}"`;
  if (etagMatches(req.headers.get('if-none-match'), file.sha256)) {
    return new Response(null, { status: 304, headers: { ...SECURE, ETag: etag, 'Cache-Control': cacheControl } });
  }

  const object = await source.open(file);
  if (!object) {
    console.error('[files] объект отсутствует', id);
    return text('Not found', 404);
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      ...SECURE,
      'Content-Type': file.mime,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': contentDisposition(file.kind, file.originalName),
      ETag: etag,
      'Cache-Control': cacheControl,
      'Accept-Ranges': 'none',
    },
  });
}
