import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'article' | 'section' | 'aside' | 'li';
  /** paper — белая «бумага»; night — тёмная карточка-акцент; dashed — пунктирная рамка. */
  tone?: 'paper' | 'night' | 'dashed';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Радиус 24 px для крупных карточек. */
  large?: boolean;
  /** Мягкая тень вместо одной рамки. */
  elevated?: boolean;
  /** Тень сильнее, без рамки — для формы поверх тёмной секции. */
  floating?: boolean;
  /** Подъём при наведении (карточка-ссылка). */
  interactive?: boolean;
  children?: ReactNode;
};

/** Карточка: белая «бумага» с радиусом 18 px (24 px — large). */
export function Card({
  as: Tag = 'div',
  tone = 'paper',
  padding = 'md',
  large,
  elevated,
  floating,
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
        elevated && 'card--elevated',
        floating && 'card--float',
        interactive && 'card--interactive',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
