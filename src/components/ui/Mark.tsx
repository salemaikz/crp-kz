import type { ReactNode } from 'react';

/** Ключевое слово заголовка с рукописным красным подчёркиванием (рисуется при появлении). */
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="mark">
      {children}
      <svg className="mark__svg" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path pathLength={1} d="M3 13.5C52 8.2 118 5.6 176 6.6c44 .8 82 3 121 6.9" />
      </svg>
    </span>
  );
}
