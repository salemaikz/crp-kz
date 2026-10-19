'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ActionResult } from '@/lib/admin/result';
import { cn } from '@/components/ui';

type Props = {
  /** Серверное действие с уже привязанными аргументами. */
  action: () => Promise<ActionResult>;
  /** Подпись для скринридера и подсказка (для иконки — обязательна). */
  label: string;
  /** icon — круглая кнопка с иконкой; text — пилюля с текстом. */
  variant?: 'icon' | 'text';
  tone?: 'default' | 'danger' | 'primary';
  icon?: ReactNode;
  /** Текст подтверждения (window.confirm) перед выполнением. */
  confirm?: string;
  disabled?: boolean;
  /** Почему кнопка недоступна — показывается как подсказка. */
  disabledReason?: string;
  className?: string;
  testId?: string;
};

/** Кнопка-действие без формы: «вверх», «вниз», «удалить», «опубликовать». Ошибку показывает рядом. */
export function ActionButton({
  action,
  label,
  variant = 'icon',
  tone = 'default',
  icon,
  confirm,
  disabled,
  disabledReason,
  className,
  testId,
}: Props) {
  const t = useTranslations('admin.errors');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res && !res.ok) setError(res.error);
      } catch {
        setError('GENERIC');
      }
    });
  };

  const message = error ? (t.has(error) ? t(error) : t('GENERIC')) : null;
  const cls =
    variant === 'icon'
      ? cn('adm-iconbtn', tone === 'danger' && 'adm-iconbtn--danger')
      : cn('btn btn--sm', tone === 'primary' ? 'btn--primary' : 'btn--ghost', tone === 'danger' && 'adm-btn--danger');

  return (
    <span className={cn('adm-action', className)}>
      <button
        type="button"
        className={cls}
        onClick={run}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        aria-label={variant === 'icon' ? label : undefined}
        title={disabled && disabledReason ? disabledReason : variant === 'icon' ? label : undefined}
        data-testid={testId}
      >
        {pending ? <span className="spinner" aria-hidden="true" /> : variant === 'icon' ? icon : null}
        {variant === 'text' && (
          <>
            {!pending && icon}
            {label}
          </>
        )}
      </button>
      {message && (
        <span role="alert" className="adm-action__error">
          {message}
        </span>
      )}
    </span>
  );
}
