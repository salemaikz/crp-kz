'use client';

import { Button } from '@/components/ui';

/** Печать счёта (в окне печати можно сохранить PDF). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
