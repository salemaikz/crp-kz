'use client';
// Тесты казахской версии не совпадают с русской: что не так и исправление в один клик.
import { ListPlus, ListX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';
import type { KzQuizDiff } from '@/lib/admin/kzQuizzes';

type Props = {
  diff: KzQuizDiff;
  onAddMissing: () => void;
  onRemoveExtra: () => void;
  /** Ошибка сохранения (в панели сохранения) или живая подсказка (на вкладке ҚАЗ). */
  tone: 'error' | 'warning';
  testId: string;
};

export function KzQuizMismatch({ diff, onAddMissing, onRemoveExtra, tone, testId }: Props) {
  const t = useTranslations('admin.lessonEditor.kzQuiz');
  const list = (ids: string[]) => ids.join(', ');
  return (
    <Alert tone={tone} className="adm-kzquiz" data-testid={testId}>
      {diff.extra.length > 0 && (
        <div className="adm-kzquiz__row">
          <p>{t('extra', { count: diff.extra.length, ids: list(diff.extra) })}</p>
          <Button type="button" size="sm" variant="ghost" onClick={onRemoveExtra} data-testid={`${testId}-remove-extra`}>
            <ListX aria-hidden="true" />
            {t('removeExtra')}
          </Button>
        </div>
      )}
      {diff.missing.length > 0 && (
        <div className="adm-kzquiz__row">
          <p>{t('missing', { count: diff.missing.length, ids: list(diff.missing) })}</p>
          <Button type="button" size="sm" variant="ghost" onClick={onAddMissing} data-testid={`${testId}-add-missing`}>
            <ListPlus aria-hidden="true" />
            {t('addMissing')}
          </Button>
        </div>
      )}
    </Alert>
  );
}
