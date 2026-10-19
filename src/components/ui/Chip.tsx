import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Locale } from '@/lib/content/types';
import { Link } from '@/lib/i18n/navigation';
import { cn } from './cn';

type Props = {
  active?: boolean;
  className?: string;
  children: ReactNode;
} & (
  | ({ href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>)
  | { href: string; locale?: Locale; scroll?: boolean }
);

/** Чип-фильтр: кнопка (aria-pressed) или ссылка (aria-current). Активный — графитовый. */
export function Chip(props: Props) {
  if (typeof props.href === 'string') {
    const { href, locale, scroll, active, className, children } = props;
    return (
      <Link
        href={href}
        locale={locale}
        scroll={scroll}
        aria-current={active ? 'page' : undefined}
        className={cn('chip', className)}
      >
        {children}
      </Link>
    );
  }
  const { active, className, children, type = 'button', href: _href, ...rest } = props;
  void _href;
  return (
    <button type={type} aria-pressed={active} className={cn('chip', className)} {...rest}>
      {children}
    </button>
  );
}
