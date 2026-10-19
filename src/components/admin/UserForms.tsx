'use client';
// Формы карточки пользователя: выдать доступ к курсу, сменить роль.
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Field, Input, Select, SubmitButton } from '@/components/ui';
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
