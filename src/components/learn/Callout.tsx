import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { CalloutBlock } from '@/lib/content/types';
import './learn.css';

/** Выноска урока: info / warn / success. Значок у предупреждения и успеха: статус не держится на одном цвете. Абзацы — по пустой строке. */
export function Callout({ block }: { block: CalloutBlock }) {
  const paragraphs = block.text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <aside className="lrn-callout" data-tone={block.tone}>
      {block.tone === 'warn' && <TriangleAlert aria-hidden="true" />}
      {block.tone === 'success' && <CircleCheck aria-hidden="true" />}
      <div>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </aside>
  );
}
