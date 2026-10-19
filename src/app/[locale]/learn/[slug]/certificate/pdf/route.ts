// PDF сертификата: только свой, по сессии. Чужой или несуществующий — одинаковый 404.
// Файл не хранится: генерируется на запросе; повторный запрос с тем же ETag даёт 304 без рендера.
import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/auth';
import { safeNext } from '@/lib/auth/safeNext';
import { isFeatureActive } from '@/lib/features';
import { routing } from '@/lib/i18n/routing';
import { certPdfAllowed } from '@/lib/learn/limits';
import { certificatePdfEtag } from '@/lib/learn/pdf/etag';
import { loadCertificatePdfInput } from '@/lib/learn/pdf/data';
import { planCertificatePdf } from '@/lib/learn/pdf/plan';
import { PdfConfigError } from '@/lib/learn/pdf/types';
import { coursePath, routeParam } from '@/lib/learn/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ locale: string; slug: string }> };

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

/** If-None-Match: список ETag или «*»; сравнение слабое (без префикса W/). */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const strip = (v: string) => v.trim().replace(/^W\//, '');
  return header.split(',').some((v) => v.trim() === '*' || strip(v) === strip(etag));
}

export async function GET(request: Request, { params }: Ctx) {
  // 1. флаг: выключен — маршрута нет
  if (!isFeatureActive('CERT_PDF')) return text('Not found', 404);

  const { locale: rawLocale, slug: rawSlug } = await params;
  const locale = (routing.locales as readonly string[]).includes(rawLocale) ? rawLocale : routing.defaultLocale;
  const slug = routeParam(rawSlug);

  // 2. гость — на вход, возврат на страницу сертификата (не на сам PDF)
  const user = await getCurrentUser();
  if (!user) {
    const next = safeNext(`/${locale}${coursePath(slug)}/certificate`);
    const login = next ? `/${locale}/login?next=${encodeURIComponent(next)}` : `/${locale}/login`;
    return new Response(null, { status: 303, headers: { Location: login, 'Cache-Control': 'no-store' } });
  }

  // 3. лимит на пользователя: рендер нагружает процессор
  const limit = certPdfAllowed(user.id);
  if (!limit.ok) {
    const t = await getTranslations({ locale, namespace: 'learn.certificate' });
    return text(t('pdfTooMany'), 429, { 'Retry-After': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) });
  }

  // 4. сертификат только свой; «нет курса» и «нет сертификата» неотличимы
  let input;
  try {
    input = await loadCertificatePdfInput(user.id, slug);
  } catch (e) {
    if (e instanceof PdfConfigError) return text('Service unavailable', 503);
    throw e;
  }
  if (!input) return text('Not found', 404);

  // 4а. PDF недоступен (пустое имя или курс, обрезанные буквы, не влезает по высоте): то же правило,
  // что на странице. Отправляем на HTML-страницу сертификата (та же локаль, что в адресе)
  if (!planCertificatePdf(input).ok) {
    return new Response(null, {
      status: 303,
      headers: { Location: `/${locale}${coursePath(slug)}/certificate`, 'Cache-Control': 'no-store' },
    });
  }

  // 5. 304 — только после проверки владельца
  const etag = certificatePdfEtag(input);
  const headers = {
    'Cache-Control': 'private, no-cache',
    ETag: etag,
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  };
  if (etagMatches(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });

  // 6. тяжёлый модуль — лениво. В журнал при ошибке — только номер, без ФИО
  try {
    const { renderCertificatePdf } = await import('@/lib/learn/pdf/render');
    const body = await renderCertificatePdf(input);
    return new Response(body as BodyInit, {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${input.number}.pdf"`,
        'Content-Length': String(body.byteLength),
      },
    });
  } catch {
    console.error(`certificate pdf: render failed, number=${input.number}`);
    return text('Internal error', 500);
  }
}
