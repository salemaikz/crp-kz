import { notFound } from 'next/navigation';

// Любой неизвестный путь внутри локали → локализованная 404 с шапкой
export default function CatchAll() {
  notFound();
}
