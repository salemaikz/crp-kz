import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from './cn';

type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** Иконка lucide-react; по умолчанию — Inbox. */
  icon?: ReactNode;
  /** Кнопки действий. */
  action?: ReactNode;
  /** Обернуть в белую карточку (по умолчанию да). */
  framed?: boolean;
  headingLevel?: 'h2' | 'h3';
  className?: string;
};

/** Пустое состояние: иконка в «кольцах», заголовок, пояснение и следующее действие. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  framed = true,
  headingLevel: H = 'h2',
  className,
}: Props) {
  return (
    <div className={cn('empty', framed && 'card card--lg', className)}>
      <div className="empty__icon" aria-hidden="true">
        {icon ?? <Inbox />}
      </div>
      <H className="empty__title">{title}</H>
      {description && <p className="empty__text">{description}</p>}
      {action && <div className="empty__actions">{action}</div>}
    </div>
  );
}
