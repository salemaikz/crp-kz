import { Check, Lock } from 'lucide-react';
import { cn } from '@/components/ui';
import type { LessonState } from '@/lib/learn/types';
import './learn.css';

/** Значок состояния урока: пройден (галочка), текущий (красная точка), закрыт (замок), доступен (пустой круг). */
export function StatusIcon({ state, current }: { state: LessonState; current?: boolean }) {
  if (state === 'done') {
    return (
      <span className="lrn-status lrn-status--done" aria-hidden="true">
        <Check strokeWidth={3} />
      </span>
    );
  }
  if (state === 'locked') {
    return (
      <span className="lrn-status lrn-status--locked" aria-hidden="true">
        <Lock />
      </span>
    );
  }
  return <span className={cn('lrn-status', current && 'lrn-status--current')} aria-hidden="true" />;
}
