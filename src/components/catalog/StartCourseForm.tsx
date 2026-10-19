'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, SubmitButton } from '@/components/ui';
import { startCourseAction, type StartCourseState } from '@/lib/catalog/actions';

type Props = {
  slug: string;
  label: string;
  size?: 'md' | 'lg';
  /** Подсказка под кнопкой («для начала нужен вход»). */
  hint?: string;
};

/** Кнопка «Начать бесплатно / Начать обучение»: server action с ошибкой над кнопкой. */
export function StartCourseForm({ slug, label, size = 'lg', hint }: Props) {
  const t = useTranslations('catalog.course');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<StartCourseState, FormData>(startCourseAction, undefined);

  return (
    <form action={formAction} className="cat-start">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      {state?.error && <Alert tone="error">{t(`errors.${state.error}`)}</Alert>}
      <SubmitButton variant="primary" size={size} block pending={pending} pendingText={t('cta.starting')}>
        {label}
      </SubmitButton>
      {hint && <p className="cat-start__hint">{hint}</p>}
    </form>
  );
}
