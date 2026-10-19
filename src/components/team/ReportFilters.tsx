'use client';

import { useTranslations } from 'next-intl';
import { Field, Select } from '@/components/ui';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import type { TeamStatusFilter } from '@/lib/team/types';
import './team.css';

type Props = {
  /** slug организации — остаётся в адресе при смене фильтров. */
  org: string;
  /** Только если у руководителя несколько организаций (иначе ?org= не нужен). */
  keepOrg: boolean;
  courses: Array<{ id: string; title: string }>;
  statuses: readonly TeamStatusFilter[];
  course: string | null;
  status: TeamStatusFilter | null;
};

/** Фильтры отчёта по курсу и статусу: меняют адрес (?course=&status=), страница перерисовывается на сервере. */
export function ReportFilters({ org, keepOrg, courses, statuses, course, status }: Props) {
  const t = useTranslations('team.report.filters');
  const tGroups = useTranslations('team.report.statusGroups');
  const router = useRouter();
  const pathname = usePathname();

  const go = (next: { course?: string | null; status?: string | null }) => {
    const params = new URLSearchParams();
    if (keepOrg) params.set('org', org);
    const c = next.course === undefined ? course : next.course;
    const s = next.status === undefined ? status : next.status;
    if (c) params.set('course', c);
    if (s) params.set('status', s);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="team-filters" role="group" aria-label={t('label')}>
      <Field label={t('course')}>
        <Select name="course" value={course ?? ''} onChange={(e) => go({ course: e.target.value || null })}>
          <option value="">{t('allCourses')}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('status')}>
        <Select name="status" value={status ?? ''} onChange={(e) => go({ status: e.target.value || null })}>
          <option value="">{t('allStatuses')}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {tGroups(s)}
            </option>
          ))}
        </Select>
      </Field>
      {(course || status) && (
        <button type="button" className="team-link-btn team-filters__reset" onClick={() => go({ course: null, status: null })}>
          {t('reset')}
        </button>
      )}
    </div>
  );
}
