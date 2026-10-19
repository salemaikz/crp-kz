import type { ReactNode } from 'react';
import { Circles } from './Circles';
import { Container } from './Container';
import { Eyebrow } from './Eyebrow';
import { cn } from './cn';

type Props = {
  title: ReactNode;
  eyebrow?: ReactNode;
  lead?: ReactNode;
  /** Кнопки под заголовком. */
  actions?: ReactNode;
  /** Хлебные крошки над заголовком. */
  breadcrumbs?: ReactNode;
  /** Полоса с метаданными/цифрами под текстом (Stat, Badge…). */
  meta?: ReactNode;
  /** Правая колонка на десктопе (карточка цены, прогресс курса). */
  aside?: ReactNode;
  /** night — тёмная с красным свечением и кольцами (продолжает шапку); board; paper. */
  tone?: 'board' | 'paper' | 'night';
  /** Скрыть декоративные кольца в night. */
  plain?: boolean;
  className?: string;
};

/** Шапка страницы: eyebrow + заголовок h1 + лид + действия. */
export function PageHeader({
  title,
  eyebrow,
  lead,
  actions,
  breadcrumbs,
  meta,
  aside,
  tone = 'board',
  plain,
  className,
}: Props) {
  const night = tone === 'night';
  return (
    <header className={cn('page-header', `page-header--${tone}`, night && 'on-night', className)}>
      {night && !plain && <Circles className="page-header__rings" />}
      <Container className={cn('page-header__grid', aside ? 'page-header__grid--aside' : undefined)}>
        <div className="page-header__copy">
          {breadcrumbs}
          {eyebrow && <Eyebrow variant={night ? 'dot' : 'line'}>{eyebrow}</Eyebrow>}
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
