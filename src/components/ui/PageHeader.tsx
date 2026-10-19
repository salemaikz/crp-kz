import type { ReactNode } from 'react';
import { Container } from './Container';
import { cn } from './cn';

type Props = {
  title: ReactNode;
  /** Одна строка пояснения: что это и для кого. */
  lead?: ReactNode;
  /** Кнопки под заголовком. */
  actions?: ReactNode;
  /** Хлебные крошки над заголовком. */
  breadcrumbs?: ReactNode;
  /** Строка фактов мелким текстом (статус, срок, цена) под текстом. */
  meta?: ReactNode;
  /** Правая колонка на десктопе (карточка цены, прогресс курса). */
  aside?: ReactNode;
  /**
   * board — «доска» (по умолчанию); night — сплошной --night с белым текстом,
   * без колец и свечения (страница курса).
   */
  tone?: 'board' | 'night';
  className?: string;
};

/** Шапка внутренней страницы: крошки, h1, одна строка пояснения, действия. */
export function PageHeader({ title, lead, actions, breadcrumbs, meta, aside, tone = 'board', className }: Props) {
  const night = tone === 'night';
  return (
    <header className={cn('page-header', `page-header--${tone}`, night && 'on-night', className)}>
      <Container className={cn('page-header__grid', aside ? 'page-header__grid--aside' : undefined)}>
        <div className="page-header__copy">
          {breadcrumbs}
          <h1 className="display page-header__title">{title}</h1>
          {lead && <p className="lead page-header__lead">{lead}</p>}
          {actions && <div className="page-header__actions">{actions}</div>}
          {meta && <div className="page-header__meta">{meta}</div>}
        </div>
        {aside && <div className="page-header__aside">{aside}</div>}
      </Container>
    </header>
  );
}
