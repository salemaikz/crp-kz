import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Locale } from '@/lib/content/types';
import { Link } from '@/lib/i18n/navigation';
import { cn } from './cn';
import { isExternalHref } from './href';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  locale?: Locale;
  children: ReactNode;
};

/** Жирная ссылка с подчёркиванием и «→», при наведении красная. */
export function LinkArrow({ href, locale, className, children, ...rest }: Props) {
  const content = (
    <>
      {children}
      <ArrowRight aria-hidden="true" />
    </>
  );
  const cls = cn('link-arrow', className);
  if (isExternalHref(href)) {
    return (
      <a href={href} className={cls} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} locale={locale} className={cls} {...rest}>
      {content}
    </Link>
  );
}
