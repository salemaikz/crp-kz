import type { ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** Иконка lucide-react (по желанию): простая линейная, 28 px, без круга и фона. По умолчанию без иконки. */
  icon?: ReactNode;
  /** Кнопки действий. */
  action?: ReactNode;
  /** Обернуть в белую карточку (по умолчанию да). */
  framed?: boolean;
  headingLevel?: 'h2' | 'h3';
  className?: string;
};

/** Пустое состояние: заголовок, пояснение и следующее действие; иконка необязательна. */
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
      {icon && (
        <div className="empty__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <H className="empty__title">{title}</H>
      {description && <p className="empty__text">{description}</p>}
      {action && <div className="empty__actions">{action}</div>}
    </div>
  );
}
