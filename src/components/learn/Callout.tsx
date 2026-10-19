import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { CalloutBlock } from '@/lib/content/types';
import './learn.css';

const ICONS = { info: Info, warn: TriangleAlert, success: CircleCheck } as const;

/** Выноска урока: info / warn / success. Текст простой, абзацы — по пустой строке. */
export function Callout({ block }: { block: CalloutBlock }) {
  const Icon = ICONS[block.tone];
  const paragraphs = block.text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <aside className="lrn-callout" data-tone={block.tone}>
      <Icon aria-hidden="true" />
      <div>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </aside>
  );
}
