import type { InputHTMLAttributes, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from './cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Текст справа от галочки (можно со ссылками). */
  label: ReactNode;
  error?: ReactNode;
  className?: string;
};

/** Галочка с подписью и ошибкой (согласие на ПДн, «запомнить» и т. п.). */
export function Checkbox({ label, error, className, id, name, ...rest }: Props) {
  const inputId = id ?? (name ? `check-${name}` : undefined);
  const errorId = error && inputId ? `${inputId}-error` : undefined;
  return (
    <div className={cn('check-field', className)}>
      <label className="check" htmlFor={inputId}>
        <input
          type="checkbox"
          id={inputId}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          {...rest}
        />
        <span>{label}</span>
      </label>
      {error && (
        <p id={errorId} className="field__error">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
