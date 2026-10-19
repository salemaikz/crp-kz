import type { ReactNode } from 'react';

// Корневой layout только пропускает детей: <html> с языком рисует [locale]/layout.tsx.
// Нужен, потому что app/not-found.tsx лежит вне сегмента [locale].
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
