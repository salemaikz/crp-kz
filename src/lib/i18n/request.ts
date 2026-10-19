import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing, type AppLocale } from './routing';

/**
 * Пространства имён сообщений: messages/<locale>/<ns>.json → ключ верхнего уровня <ns>.
 * Новый файл — добавить сюда. Отсутствующий файл не ломает сборку: вместо него {}.
 */
export const NAMESPACES = ['common', 'auth', 'catalog', 'learn', 'checkout', 'team', 'admin'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const TIME_ZONE = 'Asia/Almaty';

type Messages = Record<string, unknown>;

async function loadNamespace(locale: AppLocale, ns: Namespace): Promise<Messages> {
  try {
    const mod = (await import(`../../../messages/${locale}/${ns}.json`)) as { default: Messages };
    return mod.default ?? {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Глубокое слияние: значения override поверх base (для запасного ru под kz). */
function deepMerge(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const prev = out[key];
    out[key] = isPlainObject(prev) && isPlainObject(value) ? deepMerge(prev, value) : value;
  }
  return out;
}

async function loadLocale(locale: AppLocale): Promise<Messages> {
  const parts = await Promise.all(NAMESPACES.map(async (ns) => [ns, await loadNamespace(locale, ns)] as const));
  return Object.fromEntries(parts);
}

/** Все сообщения локали. Для kz недостающие ключи берутся из ru, чтобы не показывать «ключи». */
export async function loadMessages(locale: AppLocale): Promise<Messages> {
  if (locale === routing.defaultLocale) return loadLocale(locale);
  const [base, own] = await Promise.all([loadLocale(routing.defaultLocale), loadLocale(locale)]);
  return deepMerge(base, own);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: TIME_ZONE,
  };
});
