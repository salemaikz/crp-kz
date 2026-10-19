import type { Locale, PublicBlock } from '@/lib/content/types';
import type { QuizStatus } from '@/lib/learn/types';
import { Callout } from './Callout';
import { Markdown } from './Markdown';
import { QuizBlock } from './QuizBlock';
import { VideoBlock } from './VideoBlock';
import './learn.css';

type Props = {
  blocks: PublicBlock[];
  lessonId: string;
  lessonTitle: string;
  locale: Locale;
  /** Сданные раньше тесты: по id блока (ключ попытки уже приведён к id документа). */
  quizStatus: Record<string, QuizStatus | null>;
};

/**
 * Блоки урока в порядке автора. Получает только PublicBlock — правильных ответов
 * и пояснений тестов в этих данных нет (их присылает сервер после попытки).
 */
export function Blocks({ blocks, lessonId, lessonTitle, locale, quizStatus }: Props) {
  return (
    <div className="lrn-blocks">
      {blocks.map((b) => {
        switch (b.type) {
          case 'heading': {
            const H = b.level === 2 ? 'h2' : 'h3';
            return (
              <H key={b.id} className="lrn-heading">
                {b.text}
              </H>
            );
          }
          case 'text':
            return <Markdown key={b.id}>{b.markdown}</Markdown>;
          case 'video':
            return <VideoBlock key={b.id} block={b} title={lessonTitle} />;
          case 'callout':
            return <Callout key={b.id} block={b} />;
          case 'divider':
            return <hr key={b.id} className="lrn-rule" />;
          case 'quiz':
            return <QuizBlock key={b.id} lessonId={lessonId} locale={locale} block={b} initial={quizStatus[b.id] ?? null} />;
        }
      })}
    </div>
  );
}
