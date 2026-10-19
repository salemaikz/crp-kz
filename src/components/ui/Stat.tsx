import type { ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  value: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  size?: 'sm' | 'md';
  /** red — ключевая цифра экрана (одна). */
  tone?: 'ink' | 'red';
  className?: string;
};

/** Крупная цифра + подпись: «12 сотрудников», «86% прошли». */
export function Stat({ value, label, hint, size = 'md', tone = 'ink', className }: Props) {
  return (
    <div className={cn('stat', size === 'sm' && 'stat--sm', tone === 'red' && 'stat--red', className)}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}
