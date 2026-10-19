import type { ReactNode } from 'react';
import { Link } from '@/lib/i18n/navigation';
import { cn } from './cn';

export type Crumb = { label: ReactNode; href?: string };

type Props = {
  items: Crumb[];
  /** aria-label навигации (из messages: common.a11y.breadcrumbs). */
  label: string;
  className?: string;
};

/** Хлебные крошки: «Курсы / Целина / Урок 3». Последний пункт — текущая страница. */
export function Breadcrumbs({ items, label, className }: Props) {
  return (
    <nav aria-label={label} className={cn('crumbs', className)}>
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {item.href && !last ? (
                <Link href={item.href}>{item.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
