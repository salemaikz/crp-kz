import { getTranslations } from 'next-intl/server';
import { Badge, type BadgeTone } from '@/components/ui';
import { dueStatus, formatDate, relativeDue } from '@/lib/format';

/** Срок назначения: просрочен (красный), сегодня и скоро (жёлтый), далеко (серый). Цвет — всегда с текстом. */
export async function DueBadge({ dueAt, locale }: { dueAt: number; locale: string }) {
  const t = await getTranslations('learn.due');
  const status = dueStatus(dueAt);
  const tone: BadgeTone = status === 'overdue' ? 'red' : status === 'ok' ? 'neutral' : 'warning';
  const text =
    status === 'overdue'
      ? t('overdue', { when: relativeDue(dueAt, locale) })
      : status === 'today'
        ? t('today')
        : status === 'soon'
          ? t('soon', { when: relativeDue(dueAt, locale) })
          : t('until', { date: formatDate(dueAt, locale) });
  return <Badge tone={tone}>{text}</Badge>;
}
