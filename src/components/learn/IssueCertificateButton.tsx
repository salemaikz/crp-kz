'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';
import { useRouter } from '@/lib/i18n/navigation';
import { issueCertificateAction } from '@/lib/learn/actions';
import type { ActionError } from '@/lib/learn/types';

type Props = {
  courseId: string;
  locale: 'ru' | 'kz';
  /** Путь страницы сертификата (без локали). */
  certificateHref: string;
  /** Сертификат уже выдан — вместо кнопки получения просто ссылка. */
  issued?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

/** «Получить сертификат»: server action идемпотентна, после выдачи — на страницу сертификата. */
export function IssueCertificateButton({ courseId, locale, certificateHref, issued, size = 'lg' }: Props) {
  const t = useTranslations('learn');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  if (issued) {
    return (
      <Button href={certificateHref} size={size} data-testid="open-certificate">
        {t('completion.open')}
      </Button>
    );
  }

  function issue() {
    setError(null);
    startTransition(async () => {
      const res = await issueCertificateAction({ courseId, locale });
      if (res.ok) router.push(certificateHref);
      else setError(res.error);
    });
  }

  return (
    <>
      <Button size={size} onClick={issue} disabled={pending} aria-busy={pending || undefined} data-testid="get-certificate">
        {pending && <span className="spinner" aria-hidden="true" />}
        {pending ? t('completion.getting') : t('completion.get')}
      </Button>
      {error && (
        <Alert tone="error" className="lrn-complete__error">
          {t(`errors.${error}`)}
        </Alert>
      )}
    </>
  );
}
