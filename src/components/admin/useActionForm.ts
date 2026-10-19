'use client';
// Хук форм админки: отправка server action вручную (без автосброса полей React 19),
// состояние ожидания, ошибки по полям и общий код ошибки.
import { useState, useTransition, type FormEvent } from 'react';
import type { ActionResult } from '@/lib/admin/result';

type Options<T extends object> = {
  /** Вызывается после успешного действия (например, свернуть форму или очистить поля). */
  onSuccess?: (form: HTMLFormElement, result: { ok: true } & T) => void;
};

export function useActionForm<T extends object = Record<never, never>>(
  action: (formData: FormData) => Promise<ActionResult<T>>,
  options: Options<T> = {},
) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<T> | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      let res: ActionResult<T> | undefined;
      try {
        res = await action(data);
      } catch {
        res = { ok: false, error: 'GENERIC' };
      }
      // redirect() внутри действия: навигацию делает Next, результата нет
      if (!res) return;
      setResult(res);
      if (res.ok) options.onSuccess?.(form, res);
    });
  };

  const failed = result && !result.ok ? result : null;
  return {
    onSubmit,
    pending,
    ok: result?.ok === true,
    error: failed?.error ?? null,
    fieldError: (name: string): string | undefined => failed?.fields?.[name],
    /** Сбросить показанный результат (например, при редактировании полей после успеха). */
    reset: () => setResult(null),
  };
}
