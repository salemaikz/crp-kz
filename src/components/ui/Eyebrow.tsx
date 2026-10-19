import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'p' | 'span' | 'div' | 'h2' | 'h3';
  /** line — красная чёрточка 22×2 (по умолчанию); dot — красная точка, как на первом экране. */
  variant?: 'line' | 'dot';
  children: ReactNode;
};

/** Надзаголовок секции: 14 px 600 с красной чёрточкой слева. */
export function Eyebrow({ as: Tag = 'p', variant = 'line', className, children, ...rest }: Props) {
  return (
    <Tag className={cn('eyebrow', variant === 'dot' && 'eyebrow--dot', className)} {...rest}>
      {children}
    </Tag>
  );
}
