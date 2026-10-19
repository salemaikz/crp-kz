import { getTranslations } from 'next-intl/server';
import { Badge, type BadgeTone } from '@/components/ui';
import type { MailStatus } from '@/lib/mail/types';

const TONE: Record<MailStatus, BadgeTone> = {
  held: 'neutral',
  queued: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'red',
  cancelled: 'warning',
};

/** Статус письма цветом и текстом (цвет не единственный носитель смысла). */
export async function MailStatusBadge({ status }: { status: MailStatus }) {
  const t = await getTranslations('admin.mail.status');
  return (
    <Badge tone={TONE[status]} dot>
      {t(status)}
    </Badge>
  );
}
