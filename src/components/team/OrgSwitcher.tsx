import { Chip } from '@/components/ui';
import { orgLabel } from '@/lib/team/orgs';
import type { ManagedOrg } from '@/lib/team/types';

/** Переключатель организации — только если руководитель управляет несколькими. */
export function OrgSwitcher({ orgs, active, label }: { orgs: ManagedOrg[]; active: string; label: string }) {
  if (orgs.length < 2) return null;
  return (
    <nav aria-label={label} className="team-orgs">
      {orgs.map((o) => (
        <Chip key={o.orgId} href={`/team?org=${encodeURIComponent(o.slug)}`} active={o.slug === active}>
          {orgLabel(o)}
        </Chip>
      ))}
    </nav>
  );
}
