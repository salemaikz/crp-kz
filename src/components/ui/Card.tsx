import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'article' | 'section' | 'aside' | 'li';
  /** paper — белая «бумага»; dashed — пунктирная рамка. */
  tone?: 'paper' | 'dashed';
  padding?: 'none' | 'md' | 'lg';
  /** Радиус 28 px для крупных карточек. */
  large?: boolean;
  /** Кликабельная карточка: при наведении подъём на 4 px и тень (без reduced-motion). */
  interactive?: boolean;
  children?: ReactNode;
};

/** Карточка: плоская белая «бумага» с рамкой 1 px и радиусом 20 px (28 px — large). Тени нет. */
export function Card({
  as: Tag = 'div',
  tone = 'paper',
  padding = 'md',
  large,
  interactive,
  className,
  children,
  ...rest
}: Props) {
  return (
    <Tag
      className={cn(
        'card',
        tone !== 'paper' && `card--${tone}`,
        padding !== 'none' && `card--p-${padding}`,
        large && 'card--lg',
        interactive && 'card--interactive',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
