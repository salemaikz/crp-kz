// Выдача файлов (D-034): доступ проверяется на каждый запрос в src/lib/files/http.ts.
import { getCurrentUser } from '@/lib/auth';
import { deriveClientIp } from '@/lib/auth/clientIp';
import { handleDownload } from '@/lib/files/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleDownload(request, id, {
    getUser: async () => {
      const u = await getCurrentUser();
      return u ? { id: u.id, role: u.role } : null;
    },
    clientIp: (h) => deriveClientIp(h),
  });
}
