import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Локализованные обёртки над навигацией Next: href без префикса локали, он добавится сам.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
