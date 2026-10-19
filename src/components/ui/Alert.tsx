import type { HTMLAttributes, ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from './cn';

type Tone = 'info' | 'success' | 'warning' | 'error';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
};

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert } as const;

/** Сообщение с иконкой: ошибка формы, успех, предупреждение. error объявляется скринридером сразу. */
export function Alert({ tone = 'info', title, className, children, role, ...rest }: Props) {
  const Icon = ICONS[tone];
  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : 'status')}
      className={cn('alert', tone !== 'info' && `alert--${tone}`, className)}
      {...rest}
    >
      <Icon aria-hidden="true" />
      <div>
        {title && <strong className="alert__title">{title}</strong>}
        {children}
      </div>
    </div>
  );
}
