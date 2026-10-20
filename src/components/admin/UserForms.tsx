'use client';
// Формы карточки пользователя: выдать доступ к курсу, сменить роль, отправить ссылку для смены пароля.
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input, Select, SubmitButton } from '@/components/ui';
import type { ActionResult } from '@/lib/admin/result';
import { ErrorAlert } from './ErrorAlert';
import { useActionForm } from './useActionForm';

type Action = (formData: FormData) => Promise<ActionResult>;

function useFieldText(fieldError: (name: string) => string | undefined) {
  const tf = useTranslations('admin.errors.field');
  return (name: string): string | undefined => {
    const code = fieldError(name);
    return code ? (tf.has(code) ? tf(code) : tf('invalid')) : undefined;
  };
}

export type CourseChoice = { id: string; title: string; draft: boolean };

/** «Выдать доступ»: курс + необязательный срок в днях. */
export function GrantAccessForm({ action, courses }: { action: Action; courses: CourseChoice[] }) {
  const t = useTranslations('admin.users.detail.grant');
  const form = useActionForm(action, { onSuccess: (f) => f.reset() });
  const err = useFieldText(form.fieldError);
  return (
    <form onSubmit={form.onSubmit} noValidate className="adm-grant" data-testid="grant-form" onChange={form.ok ? form.reset : undefined}>
      {form.error && <ErrorAlert code={form.error} />}
      <div className="adm-grant__row">
        <Field label={t('course')} required error={err('courseId')}>
          <Select name="courseId" defaultValue="">
            <option value="" disabled>
              {t('choose')}
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.draft ? ` · ${t('draftSuffix')}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('days')} error={err('accessDays')}>
          <Input name="accessDays" inputMode="numeric" placeholder={t('daysPlaceholder')} />
        </Field>
        <SubmitButton pending={form.pending} pendingText={t('pending')} data-testid="grant-submit">
          {t('submit')}
        </SubmitButton>
      </div>
      {form.ok && (
        <p className="adm-savebar__ok" role="status">
          <Check aria-hidden="true" /> {t('done')}
        </p>
      )}
    </form>
  );
}

type RoleProps = {
  action: Action;
  current: 'learner' | 'author' | 'admin';
  /** Свою роль менять нельзя. */
  self: boolean;
};

export function RoleForm({ action, current, self }: RoleProps) {
  const t = useTranslations('admin.users.detail.role');
  const tEnum = useTranslations('admin.enums.role');
  const form = useActionForm(action);
  const err = useFieldText(form.fieldError);
  return (
    <form onSubmit={form.onSubmit} noValidate className="adm-role" onChange={form.ok ? form.reset : undefined}>
      {form.error && <ErrorAlert code={form.error} />}
      <div className="adm-role__row">
        <Field label={t('label')} error={err('role')}>
          <Select name="role" defaultValue={current} disabled={self}>
            <option value="learner">{tEnum('learner')}</option>
            <option value="author">{tEnum('author')}</option>
            <option value="admin">{tEnum('admin')}</option>
          </Select>
        </Field>
        <SubmitButton pending={form.pending} pendingText={t('pending')} disabled={self} variant="dark">
          {t('save')}
        </SubmitButton>
      </div>
      {self && <p className="field__hint">{t('self')}</p>}
      {form.ok && (
        <p className="adm-savebar__ok" role="status">
          <Check aria-hidden="true" /> {t('saved')}
        </p>
      )}
    </form>
  );
}

/** Причины, по которым ссылка не ушла: у каждой свой текст в admin.users.sendResetFailed. */
const RESET_REASONS = ['not_found', 'demo_seed', 'rate_limited', 'unavailable'] as const;

/**
 * «Отправить ссылку для смены пароля». Ответ «поставлено в очередь» показывается только при успехе
 * действия; отказ (демо-аккаунт, лимит, недоступная очередь) — своим текстом.
 */
export function SendResetLinkButton({ action }: { action: () => Promise<ActionResult> }) {
  const t = useTranslations('admin.users');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = () => {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await action());
      } catch {
        setResult({ ok: false, error: 'GENERIC' });
      }
    });
  };

  const reason = result && !result.ok ? RESET_REASONS.find((r) => r === result.error) : undefined;
  return (
    <div className="adm-action" data-testid="send-reset">
      <Button type="button" variant="ghost" size="sm" onClick={run} disabled={pending} aria-busy={pending || undefined} data-testid="send-reset-button">
        {pending && <span className="spinner" aria-hidden="true" />}
        {t('sendReset')}
      </Button>
      {result?.ok && (
        <p className="adm-savebar__ok" role="status" data-testid="send-reset-done">
          <Check aria-hidden="true" /> {t('sendResetDone')}
        </p>
      )}
      {result && !result.ok && reason && (
        <Alert tone="warning" data-testid="send-reset-failed">
          {t(`sendResetFailed.${reason}`)}
        </Alert>
      )}
      {result && !result.ok && !reason && <ErrorAlert code={result.error} />}
    </div>
  );
}
