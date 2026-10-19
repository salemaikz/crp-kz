import { getTranslations } from 'next-intl/server';
import { isDemo } from '@/lib/env';

/** Тонкая плашка над шапкой в демо-режиме (PGlite, данные из сида). */
export async function DemoBanner() {
  if (!isDemo()) return null;
  const t = await getTranslations('common.demo');
  return (
    <div className="demo-banner" role="note">
      <div className="container demo-banner__row">
        <span className="demo-banner__dot" aria-hidden="true" />
        <span className="demo-banner__badge">{t('badge')}</span>
        <span>{t('banner')}</span>
      </div>
    </div>
  );
}
