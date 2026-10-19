import { useTranslations } from 'next-intl';

/** Скелет страницы админки на время загрузки данных. */
export default function AdminLoading() {
  const t = useTranslations('common.actions');
  return (
    <div className="adm-skeleton" role="status" aria-busy="true">
      <span className="visually-hidden">{t('loading')}</span>
      <div className="adm-skeleton__bar adm-skeleton__bar--title" />
      <div className="adm-skeleton__bar" style={{ width: 'min(560px, 90%)' }} />
      <div className="adm-skeleton__bar adm-skeleton__bar--card" />
      <div className="adm-skeleton__bar adm-skeleton__bar--card" />
    </div>
  );
}
