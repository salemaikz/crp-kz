import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'red' | 'success' | 'warning' | 'info';

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** Точка-индикатор перед текстом. */
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
};

/** Статус-пилюля: «Пройдено», «Ожидает оплаты», «Срок скоро». Цвет всегда вместе с текстом. */
export function Badge({ tone = 'neutral', dot, icon, className, children, ...rest }: Props) {
  return (
    <span className={cn('badge', `badge--${tone}`, dot && 'badge--dot', className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
