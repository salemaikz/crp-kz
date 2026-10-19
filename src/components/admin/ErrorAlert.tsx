'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui';

/** Общая ошибка действия по коду (AdminErrorCode или GENERIC). */
export function ErrorAlert({ code, className }: { code: string | null; className?: string }) {
  const t = useTranslations('admin.errors');
  if (!code) return null;
  return (
    <Alert tone="error" className={className}>
      {t.has(code) ? t(code) : t('GENERIC')}
    </Alert>
  );
}
