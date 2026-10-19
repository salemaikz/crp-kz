import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Locale } from '@/lib/content/types';
import { LEGAL_DOC_SLUG } from '@/lib/legal/types';

type Props = {
  /** Ключ legal.consent.*: подпись галочки. */
  id: 'register' | 'checkoutOffer' | 'checkoutPd';
  locale: Locale;
};

/**
 * Подпись галочки с ссылками на документы. Каждая ссылка открывается в новой вкладке, чтобы не
 * потерять заполненную форму; скрытый текст сообщает об этом скринридеру.
 */
export async function ConsentLabel({ id, locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'legal.consent' });
  const link = (slug: string) => {
    const Anchor = (chunks: ReactNode) => (
      <a href={`/${locale}/legal/${slug}`} target="_blank" rel="noopener">
        {chunks}
        <span className="visually-hidden"> ({t('newTab')})</span>
      </a>
    );
    return Anchor;
  };
  return (
    <>
      {t.rich(id, {
        offer: link(LEGAL_DOC_SLUG.offer),
        privacy: link(LEGAL_DOC_SLUG.privacy),
        consent: link(LEGAL_DOC_SLUG.pd_consent),
        refund: link(LEGAL_DOC_SLUG.refund),
      })}
    </>
  );
}
