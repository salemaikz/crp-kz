import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'header' | 'footer' | 'nav' | 'main' | 'article';
  /** default — 1200 px; narrow — 760 px (формы, чтение); reading — 68ch (текст урока). */
  size?: 'default' | 'narrow' | 'reading';
  children?: ReactNode;
};

/** Контейнер 1200 px с гаттером clamp(16px, 4vw, 40px). */
export function Container({ as: Tag = 'div', size = 'default', className, children, ...rest }: Props) {
  return (
    <Tag className={cn('container', size !== 'default' && `container--${size}`, className)} {...rest}>
      {children}
    </Tag>
  );
}
