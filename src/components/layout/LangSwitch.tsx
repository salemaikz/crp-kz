'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Link, usePathname } from '@/lib/i18n/navigation';
import { routing, type AppLocale } from '@/lib/i18n/routing';

type Labels = Record<AppLocale, { short: string; full: string }>;
type Props = { label: string; labels: Labels };

// hreflang — ISO-код языка: kz → kk (D-002)
const HREFLANG: Record<AppLocale, string> = { ru: 'ru', kz: 'kk' };

function Switch({ label, labels, query }: Props & { query?: string }) {
  const pathname = usePathname();
  const current = useLocale();
  const href = query ? `${pathname}?${query}` : pathname;
  return (
    <nav className="lang-switch" aria-label={label}>
      {routing.locales.map((l) => (
        <Link
          key={l}
          href={href}
          locale={l}
          prefetch={false}
          hrefLang={HREFLANG[l]}
          lang={HREFLANG[l]}
          title={labels[l].full}
          aria-current={l === current ? 'true' : undefined}
        >
          {labels[l].short}
        </Link>
      ))}
    </nav>
  );
}

function SwitchWithQuery(props: Props) {
  const query = useSearchParams().toString();
  return <Switch {...props} query={query} />;
}

/** «Пилюля» РУС/ҚАЗ: та же страница (и query) на другом языке. */
export function LangSwitch(props: Props) {
  return (
    <Suspense fallback={<Switch {...props} />}>
      <SwitchWithQuery {...props} />
    </Suspense>
  );
}
