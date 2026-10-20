// Загрузка файлов (D-034): сырое тело, проверки и запись — в src/lib/files/http.ts.
import { getCurrentUser } from '@/lib/auth';
import { deriveClientIp } from '@/lib/auth/clientIp';
import { handleUpload } from '@/lib/files/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleUpload(request, {
    getUser: async () => {
      const u = await getCurrentUser();
      return u ? { id: u.id, role: u.role } : null;
    },
    clientIp: (h) => deriveClientIp(h),
  });
}
