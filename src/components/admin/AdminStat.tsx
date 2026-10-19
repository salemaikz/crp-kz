import type { ReactNode } from 'react';
import { Stat } from '@/components/ui';
import { Link } from '@/lib/i18n/navigation';

type Props = {
  value: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  /** С адресом счётчик становится ссылкой на раздел. */
  href?: string;
  /** red — число, требующее внимания (например, заказы без оплаты). */
  tone?: 'ink' | 'red';
  testId?: string;
};

/** Рабочий счётчик админки: плоская ячейка с рамкой, без значков и теней. */
export function AdminStat({ value, label, hint, href, tone, testId }: Props) {
  const stat = <Stat value={value} label={label} hint={hint} tone={tone} />;
  return href ? (
    <Link href={href} className="adm-stat adm-stat--link" data-testid={testId}>
      {stat}
    </Link>
  ) : (
    <div className="adm-stat" data-testid={testId}>
      {stat}
    </div>
  );
}
