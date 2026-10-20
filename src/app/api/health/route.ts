// GET /api/health — публичная проверка для nginx, выкладки и монитора (D-028).
// Без деталей: статусы, счётчик, id релиза и время. 200 при ok, 503 иначе.
import { getHealth } from '@/lib/ops/health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const report = await getHealth();
  return new Response(JSON.stringify(report), {
    status: report.status === 'ok' ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
