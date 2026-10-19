import createMiddleware from 'next-intl/middleware';
import { routing } from '@/lib/i18n/routing';

// Next 16: бывший middleware. Добавляет префикс локали (/ → /ru) и запоминает выбор языка.
export default createMiddleware(routing);

export const config = {
  // Всё, кроме API, служебных путей Next/Vercel и файлов с расширением.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
