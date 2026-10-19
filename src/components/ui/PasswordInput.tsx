'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from './cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { invalid?: boolean };

/** Поле пароля с кнопкой «показать/скрыть». Пропсы (id, aria-*) уходят во внутренний input. */
export function PasswordInput({ className, invalid, ...rest }: Props) {
  const t = useTranslations('common.a11y');
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-group">
      <input
        type={visible ? 'text' : 'password'}
        className={cn('input', className)}
        aria-invalid={invalid || undefined}
        autoCapitalize="none"
        spellCheck={false}
        {...rest}
      />
      <button
        type="button"
        className="input-group__btn"
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </div>
  );
}
