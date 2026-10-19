import { useTranslations } from 'next-intl';
import { Card, Stat } from '@/components/ui';
import type { TeamSummary } from '@/lib/team/types';
import './team.css';

/** Сводка: сотрудники, назначения в работе, просрочено, доля завершивших. Рабочие счётчики в плоских ячейках с рамкой. */
export function TeamStats({ summary }: { summary: TeamSummary }) {
  const t = useTranslations('team.stats');
  return (
    <section className="team-stats" aria-label={t('label')}>
      <Card padding="md">
        <Stat value={summary.employees} label={t('employees')} />
      </Card>
      <Card padding="md">
        <Stat value={summary.active} label={t('active')} />
      </Card>
      <Card padding="md">
        <Stat value={summary.overdue} label={t('overdue')} tone={summary.overdue > 0 ? 'red' : 'ink'} />
      </Card>
      <Card padding="md">
        <Stat
          value={summary.completionPercent === null ? '—' : `${summary.completionPercent}%`}
          label={t('completion')}
          hint={
            summary.completionPercent === null
              ? t('noAssignments')
              : t('completionHint', { done: summary.done, total: summary.counted })
          }
        />
      </Card>
    </section>
  );
}
