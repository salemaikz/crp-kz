import { cn } from './cn';

type Props = {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** ink — графит; light — для тёмного фона. */
  tone?: 'ink' | 'light';
  className?: string;
};

/** Инициалы: «Айдар Тулекеев» → «АТ», «admin@crp.demo» → «A». */
export function initials(name: string): string {
  const clean = name.trim().split('@')[0] ?? '';
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** Аватар-кружок с инициалами (декоративный: имя рядом выводится текстом). */
export function Avatar({ name, size = 'md', tone = 'ink', className }: Props) {
  return (
    <span
      className={cn('avatar', size !== 'md' && `avatar--${size}`, tone !== 'ink' && `avatar--${tone}`, className)}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
