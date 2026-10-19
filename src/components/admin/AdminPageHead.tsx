import type { ReactNode } from 'react';
import { Breadcrumbs, type Crumb } from '@/components/ui';

type Props = {
  title: ReactNode;
  lead?: ReactNode;
  /** Кнопки справа от заголовка (на телефоне — под ним). */
  actions?: ReactNode;
  /** Строка с бейджами и метаданными под заголовком. */
  meta?: ReactNode;
  breadcrumbs?: { items: Crumb[]; label: string };
};

/** Шапка страницы внутри админки: хлебные крошки, заголовок, лид и действия. */
export function AdminPageHead({ title, lead, actions, meta, breadcrumbs }: Props) {
  return (
    <header className="adm-head">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs.items} label={breadcrumbs.label} />}
      <div className="adm-head__row">
        <div className="adm-head__copy">
          <h1 className="display adm-head__title">{title}</h1>
          {lead && <p className="adm-head__lead">{lead}</p>}
        </div>
        {actions && <div className="adm-head__actions">{actions}</div>}
      </div>
      {meta && <div className="adm-head__meta">{meta}</div>}
    </header>
  );
}
