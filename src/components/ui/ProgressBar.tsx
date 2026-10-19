import type { ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  /** 0..100, значения вне диапазона обрезаются. */
  value: number;
  /** Подпись (обязательна для доступности; скрыть визуально — hideLabel). */
  label: ReactNode;
  /** Строка для aria-label, если label — не текст. */
  ariaLabel?: string;
  hideLabel?: boolean;
  /** Показывать «45%» справа. */
  showValue?: boolean;
  size?: 'sm' | 'md';
  /** auto — красная, на 100% зелёная; red; success. */
  tone?: 'auto' | 'red' | 'success';
  className?: string;
};

/** Полоса прогресса: красная на --line, пройдено полностью — зелёная. */
export function ProgressBar({
  value,
  label,
  ariaLabel,
  hideLabel,
  showValue = true,
  size = 'md',
  tone = 'auto',
  className,
}: Props) {
  const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
  const success = tone === 'success' || (tone === 'auto' && v >= 100);
  const textLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  return (
    <div className={cn('progress', size === 'sm' && 'progress--sm', success && 'progress--success', className)}>
      {(!hideLabel || showValue) && (
        <div className={cn('progress__head', hideLabel && !showValue && 'visually-hidden')}>
          <span className={hideLabel ? 'visually-hidden' : undefined}>{label}</span>
          {showValue && (
            <span className="progress__value" aria-hidden="true">
              {v}%
            </span>
          )}
        </div>
      )}
      <div
        className="progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={textLabel}
      >
        <span className="progress__fill" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
