import type { Locale, PublicBlock } from '@/lib/content/types';
import type { QuizStatus } from '@/lib/learn/types';
import { getTranslations } from 'next-intl/server';
import { Callout } from './Callout';
import { FileBlock } from './FileBlock';
import { ImageBlock } from './ImageBlock';
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
  /** UPLOADS активен (флаг читает страница). Выключен: блоки «Изображение» и «Файл» не выводятся. */
  filesEnabled: boolean;
  /** Демо и читатель не админ (D-038): документы не выдаются, вместо ссылки — подпись. */
  hideDocuments?: boolean;
  /** id документов урока (lesson_files, kind = document): ссылки на них в тексте выводятся подписью. */
  documentIds?: readonly string[];
};

/**
 * Блоки урока в порядке автора. Получает только PublicBlock — правильных ответов
 * и пояснений тестов в этих данных нет (их присылает сервер после попытки).
 */
export async function Blocks({ blocks, lessonId, lessonTitle, locale, quizStatus, filesEnabled, hideDocuments = false, documentIds = [] }: Props) {
  const tf = await getTranslations('files');
  const hiddenLabel = tf('block.demoHidden');
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
            return (
              <Markdown
                key={b.id}
                filesEnabled={filesEnabled}
                hiddenFileIds={hideDocuments ? documentIds : []}
                hiddenLabel={hiddenLabel}
              >
                {b.markdown}
              </Markdown>
            );
          case 'video':
            return <VideoBlock key={b.id} block={b} title={lessonTitle} />;
          case 'callout':
            return <Callout key={b.id} block={b} />;
          case 'divider':
            return <hr key={b.id} className="lrn-rule" />;
          case 'quiz':
            return <QuizBlock key={b.id} lessonId={lessonId} locale={locale} block={b} initial={quizStatus[b.id] ?? null} />;
          case 'image':
            return filesEnabled ? <ImageBlock key={b.id} block={b} /> : null;
          case 'file':
            return filesEnabled ? <FileBlock key={b.id} block={b} locale={locale} hideDocument={hideDocuments} /> : null;
        }
      })}
    </div>
  );
}
