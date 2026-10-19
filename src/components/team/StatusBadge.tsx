import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@/components/ui';
import type { TeamRowStatus } from '@/lib/team/types';

const TONE: Record<TeamRowStatus, BadgeTone> = {
  done: 'success',
  overdue: 'red',
  today: 'warning',
  soon: 'warning',
  ok: 'info',
  nodue: 'neutral',
  revoked: 'neutral',
  expired: 'neutral',
};

/** Статус назначения: цвет всегда вместе с текстом («Просрочено», «Скоро срок», «Завершено»). */
export function StatusBadge({ status }: { status: TeamRowStatus }) {
  const t = useTranslations('team.status');
  return (
    <Badge tone={TONE[status]} dot>
      {t(status)}
    </Badge>
  );
}
