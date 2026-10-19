'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';

/** «Скачать PDF»: открывает печать браузера — там «Сохранить как PDF» (A4 альбомная задана в @page). */
export function PrintButton() {
  const t = useTranslations('learn.certificate');
  return (
    <Button onClick={() => window.print()} data-testid="print-certificate">
      {t('download')}
    </Button>
  );
}
