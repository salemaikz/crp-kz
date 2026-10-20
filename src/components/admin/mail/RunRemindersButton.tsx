'use client';
// Кнопка «Сформировать напоминания» на странице «Письма» и результат под ней.
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorAlert } from '@/components/admin/ErrorAlert';
import { Alert, Button } from '@/components/ui';
import type { ActionResult } from '@/lib/admin/result';

type Result = ActionResult<{ learners: number; digests: number }>;

export function RunRemindersButton({ action }: { action: () => Promise<Result> }) {
  const t = useTranslations('admin.mail');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

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

  return (
    <div className="adm-action" data-testid="run-reminders">
      <Button type="button" variant="ghost" size="sm" onClick={run} disabled={pending} aria-busy={pending || undefined} data-testid="run-reminders-button">
        {pending && <span className="spinner" aria-hidden="true" />}
        {t('runReminders')}
      </Button>
      {result?.ok && (
        <Alert tone="success" data-testid="run-reminders-result">
          {result.learners + result.digests > 0
            ? t('runResult', { learners: result.learners, digests: result.digests })
            : t('runNone')}
        </Alert>
      )}
      {result && !result.ok && <ErrorAlert code={result.error} />}
    </div>
  );
}
