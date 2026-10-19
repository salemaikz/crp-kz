import { defineRouting } from 'next-intl/routing';
import { LOCALES } from '@/lib/content/types';

// Маршрутизация локалей: сегмент URL — ru | kz (D-002), префикс всегда.
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'ru',
  localePrefix: 'always',
  // Link-заголовок next-intl ставит hreflang="kz", а нужен ISO-код "kk" (D-002) —
  // альтернативные ссылки страницы задают сами через metadata.alternates.
  alternateLinks: false,
});

export type AppLocale = (typeof routing.locales)[number];
