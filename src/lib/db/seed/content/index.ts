// Демо-контент. Тексты написаны для демонстрации платформы и требуют замены на материалы ЦРП.
//
// Порядок курсов = порядок в каталоге (position). Сид берёт SEED_COURSES целиком
// (см. ../index.ts): цены и сроки доступа — заглушки до решения ЦРП (BUILD.md §9).
import type { SeedCourse } from '@/lib/content/types';
import { celina } from './celina';
import { operator } from './operator';
import { razbor } from './razbor';
import { salesDoubling } from './sales-doubling';

export const SEED_COURSES: SeedCourse[] = [celina, salesDoubling, razbor, operator];
