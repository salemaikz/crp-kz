import {
  Activity,
  Award,
  BookOpen,
  GraduationCap,
  KeyRound,
  Receipt,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { AuditItem } from '@/lib/admin/stats';
import type { Locale } from '@/lib/content/types';
import { formatDate } from '@/lib/format';

const ICONS: Record<string, LucideIcon> = {
  course: GraduationCap,
  module: BookOpen,
  lesson: BookOpen,
  enrollment: KeyRound,
  user: UserRound,
  order: Receipt,
  cert: Award,
  certificate: Award,
};

/** Журнал действий по-человечески: «Выдан доступ к курсу «Целина»: Марат Нурланов». */
export async function AuditFeed({ items, locale }: { items: AuditItem[]; locale: Locale }) {
  const t = await getTranslations('admin');
  if (items.length === 0) return <p className="adm-feed__empty">{t('dashboard.feed.empty')}</p>;

  return (
    <ol className="adm-feed">
      {items.map((it) => {
        const prefix = it.action.split('.')[0] ?? '';
        const Icon = ICONS[prefix] ?? Activity;
        const key = `audit.actions.${it.action}`;
        const sentence = t.has(key)
          ? t(key, {
              course: it.course || '—',
              user: it.user || '—',
              title: it.title || '—',
              number: it.number || '—',
              role: it.to && t.has(`enums.role.${it.to}`) ? t(`enums.role.${it.to}`) : '—',
            })
          : t('audit.unknown', { action: it.action });
        return (
          <li key={it.id} className="adm-feed__item">
            <span className="adm-feed__icon" aria-hidden="true">
              <Icon />
            </span>
            <div className="adm-feed__body">
              <p className="adm-feed__text">{sentence}</p>
              <p className="meta">{it.actorName ?? t('dashboard.feed.system')}</p>
            </div>
            <time className="adm-feed__time meta" dateTime={new Date(it.createdAt).toISOString()}>
              {formatDate(it.createdAt, locale, { withTime: true, short: true })}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
