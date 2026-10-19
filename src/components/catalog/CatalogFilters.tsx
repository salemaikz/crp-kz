import { getTranslations } from 'next-intl/server';
import { Chip } from '@/components/ui';
import type { CatalogFilter } from '@/lib/catalog/types';
import './catalog.css';

type Props = {
  active: CatalogFilter;
  /** Какие фильтры показывать (у гостя нет «Для сотрудников»). */
  available: readonly CatalogFilter[];
  counts: Record<CatalogFilter, number>;
};

/** Чипы-фильтры каталога: ссылки с ?f=… (работают без JS, адрес можно сохранить). */
export async function CatalogFilters({ active, available, counts }: Props) {
  const t = await getTranslations('catalog.list');
  return (
    <nav className="cat-filters" aria-label={t('filterLabel')}>
      {available.map((f) => (
        <Chip key={f} href={f === 'all' ? '/courses' : `/courses?f=${f}`} active={f === active} scroll={false}>
          {t(`filters.${f}`)}
          <span className="cat-filters__count">{counts[f]}</span>
        </Chip>
      ))}
    </nav>
  );
}
