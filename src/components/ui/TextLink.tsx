import type { AnchorHTMLAttributes, ReactNode } from 'react';
import type { Locale } from '@/lib/content/types';
import { Link } from '@/lib/i18n/navigation';
import { cn } from './cn';
import { isExternalHref } from './href';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  locale?: Locale;
  children: ReactNode;
};

/** Жирная ссылка с подчёркиванием. Без стрелки и иконки (BRAND.md, «Без ИИ-шума»). */
export function TextLink({ href, locale, className, children, ...rest }: Props) {
  const cls = cn('text-link', className);
  if (isExternalHref(href)) {
    return (
      <a href={href} className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} locale={locale} className={cls} {...rest}>
      {children}
    </Link>
  );
}
