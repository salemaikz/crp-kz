'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export type TabItem = {
  id: string;
  label: ReactNode;
  /** Счётчик рядом с названием. */
  count?: number;
  content: ReactNode;
};

type Props = {
  items: TabItem[];
  /** Подпись группы вкладок для скринридера. */
  label: string;
  defaultTab?: string;
  /** Управляемый режим. */
  value?: string;
  onChange?: (id: string) => void;
  className?: string;
};

/** Вкладки-чипы (WAI-ARIA tabs): стрелки ←/→, Home/End. */
export function Tabs({ items, label, defaultTab, value, onChange, className }: Props) {
  const baseId = useId();
  const [inner, setInner] = useState(defaultTab ?? items[0]?.id);
  const active = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (id: string, focusIndex?: number) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
    if (focusIndex !== undefined) refs.current[focusIndex]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    const item = items[next];
    if (item) select(item.id, next);
  };

  return (
    <div className={cn('tabs', className)}>
      <div role="tablist" aria-label={label} className="tabs__list">
        {items.map((item, i) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              className="chip"
              onClick={() => select(item.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {item.label}
              {item.count !== undefined && <span className="tabs__count">{item.count}</span>}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="tabs__panel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
