import type { ReactNode } from 'react';

/**
 * Красная линия-маркер под одним словом заголовка. Только под одним словом
 * заголовка первого экрана главной (D-023); статичная, больше нигде.
 */
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="mark">
      {children}
      <svg className="mark__svg" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M3 13.5C52 8.2 118 5.6 176 6.6c44 .8 82 3 121 6.9" />
      </svg>
    </span>
  );
}
