import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProgramModule } from '@/lib/catalog/types';
import type { Locale } from '@/lib/content/types';
import { t as pick } from '@/lib/content/l10n';
import { formatDuration } from '@/lib/format';
import './catalog.css';

type Props = { modules: ProgramModule[]; locale: Locale };

/**
 * Программа курса: модули → уроки, только названия и длительность (содержимое уроков не отдаём).
 * Нативный <details>: работает без JS и с клавиатуры. Первый модуль раскрыт.
 */
export function ProgramAccordion({ modules, locale }: Props) {
  const t = useTranslations('catalog');
  if (modules.length === 0) return <p className="muted">{t('course.program.empty')}</p>;

  // сквозная нумерация уроков по всему курсу: номер первого урока каждого модуля
  const starts: number[] = [];
  let total = 0;
  for (const m of modules) {
    starts.push(total);
    total += m.lessons.length;
  }
  return (
    <div className="cat-program">
      {modules.map((m, i) => (
        <details key={m.id} className="cat-module" open={i === 0}>
          <summary className="cat-module__summary">
            <span className="cat-module__num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="cat-module__text">
              <span className="cat-module__title">{pick(m.title, locale)}</span>
              <span className="cat-module__meta">
                {t('course.program.summary', {
                  lessons: t('counts.lessons', { count: m.lessons.length }),
                  duration: formatDuration(m.durationMin, locale),
                })}
              </span>
            </span>
            <ChevronDown className="cat-module__chevron" aria-hidden="true" />
          </summary>
          <ol className="cat-lessons">
            {m.lessons.map((l, li) => {
              const n = (starts[i] ?? 0) + li + 1;
              return (
                <li key={l.id}>
                  <span className="cat-lessons__n" aria-hidden="true">
                    {n}
                  </span>
                  <span className="cat-lessons__title">
                    <span className="visually-hidden">{t('course.program.lessonN', { n })}. </span>
                    {pick(l.title, locale)}
                  </span>
                  {l.durationMin > 0 && <span className="cat-lessons__dur">{formatDuration(l.durationMin, locale)}</span>}
                </li>
              );
            })}
          </ol>
        </details>
      ))}
    </div>
  );
}
