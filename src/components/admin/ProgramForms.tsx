'use client';
// Клиентские формы программы курса: добавить модуль, переименовать модуль, добавить урок.
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, SubmitButton } from '@/components/ui';
import type { ActionResult } from '@/lib/admin/result';
import { ErrorAlert } from './ErrorAlert';
import { useActionForm } from './useActionForm';

type Action = (formData: FormData) => Promise<ActionResult>;

function useFieldErrors(fieldError: (name: string) => string | undefined) {
  const tf = useTranslations('admin.errors.field');
  return (name: string): string | undefined => {
    const code = fieldError(name);
    return code ? (tf.has(code) ? tf(code) : tf('invalid')) : undefined;
  };
}

/** Новый модуль: название на двух языках (казахское — по желанию). */
export function AddModuleForm({ action }: { action: Action }) {
  const t = useTranslations('admin.program.addModule');
  const form = useActionForm(action, { onSuccess: (f) => f.reset() });
  const err = useFieldErrors(form.fieldError);
  return (
    <form onSubmit={form.onSubmit} noValidate className="adm-inline-form" data-testid="add-module-form">
      <h3 className="adm-inline-form__title">{t('title')}</h3>
      {form.error && <ErrorAlert code={form.error} />}
      <div className="adm-inline-form__row">
        <Field label={t('titleRu')} required error={err('titleRu')}>
          <Input name="titleRu" maxLength={200} placeholder={t('placeholder')} />
        </Field>
        <Field label={t('titleKz')} error={err('titleKz')}>
          <Input name="titleKz" maxLength={200} lang="kk" />
        </Field>
        <SubmitButton size="md" variant="dark" pending={form.pending} pendingText={t('pending')}>
          {t('submit')}
        </SubmitButton>
      </div>
    </form>
  );
}

type RenameProps = {
  action: Action;
  titleRu: string;
  titleKz: string;
  /** Строка под названием: «Модуль 2 · 3 урока». */
  label: string;
};

/** Название модуля с карандашом: по клику заголовок превращается в форму переименования. */
export function ModuleTitle({ action, titleRu, titleKz, label }: RenameProps) {
  const t = useTranslations('admin.program');
  const [editing, setEditing] = useState(false);
  const form = useActionForm(action, { onSuccess: () => setEditing(false) });
  const err = useFieldErrors(form.fieldError);

  if (!editing) {
    return (
      <div className="adm-module__title">
        <div className="adm-module__name">
          <h3>{titleRu}</h3>
          <button
            type="button"
            className="adm-iconbtn adm-iconbtn--sm"
            onClick={() => setEditing(true)}
            aria-label={t('moduleActions.rename')}
            title={t('moduleActions.rename')}
          >
            <Pencil aria-hidden="true" />
          </button>
        </div>
        <p className="meta adm-module__num">{label}</p>
        {titleKz && (
          <p className="meta" lang="kk">
            {titleKz}
          </p>
        )}
      </div>
    );
  }
  return (
    <form onSubmit={form.onSubmit} noValidate className="adm-rename">
      <p className="meta adm-module__num">{label}</p>
      {form.error && <ErrorAlert code={form.error} />}
      <div className="adm-rename__row">
        <Field label={t('renameForm.titleRu')} required error={err('titleRu')}>
          <Input name="titleRu" defaultValue={titleRu} maxLength={200} autoFocus />
        </Field>
        <Field label={t('renameForm.titleKz')} error={err('titleKz')}>
          <Input name="titleKz" defaultValue={titleKz} maxLength={200} lang="kk" />
        </Field>
      </div>
      <div className="adm-rename__actions">
        <SubmitButton size="sm" pending={form.pending} pendingText={t('renameForm.saving')}>
          {t('renameForm.save')}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {t('renameForm.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** «Добавить урок» внутри модуля: раскрывающаяся мини-форма. */
export function AddLessonForm({ action, moduleId }: { action: Action; moduleId: string }) {
  const t = useTranslations('admin.program.addLesson');
  const [open, setOpen] = useState(false);
  const form = useActionForm(action, {
    onSuccess: (f) => {
      f.reset();
      setOpen(false);
    },
  });
  const err = useFieldErrors(form.fieldError);

  if (!open) {
    return (
      <button type="button" className="adm-addrow" onClick={() => setOpen(true)} data-testid={`add-lesson-${moduleId}`}>
        {t('toggle')}
      </button>
    );
  }
  return (
    <form onSubmit={form.onSubmit} noValidate className="adm-inline-form adm-inline-form--lesson" data-testid="add-lesson-form">
      {form.error && <ErrorAlert code={form.error} />}
      <div className="adm-inline-form__row adm-inline-form__row--lesson">
        <Field label={t('titleRu')} required error={err('titleRu')}>
          <Input name="titleRu" maxLength={200} autoFocus placeholder={t('placeholder')} />
        </Field>
        <Field label={t('titleKz')} error={err('titleKz')}>
          <Input name="titleKz" maxLength={200} lang="kk" />
        </Field>
        <Field label={t('duration')} error={err('durationMin')}>
          <Input name="durationMin" inputMode="numeric" placeholder="10" />
        </Field>
      </div>
      <div className="adm-rename__actions">
        <SubmitButton size="sm" pending={form.pending} pendingText={t('pending')}>
          {t('submit')}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
