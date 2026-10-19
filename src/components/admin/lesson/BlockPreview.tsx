'use client';
// Простой предпросмотр блоков урока внутри админки. Свой, а не из зоны learn: показывает и ответы теста.
import { CircleCheck, Info, Play, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Block } from '@/lib/content/types';
import { Markdown } from './Markdown';

const TONE_ICON = { info: Info, warn: TriangleAlert, success: CircleCheck } as const;

export function BlockPreview({ blocks }: { blocks: readonly Block[] }) {
  const t = useTranslations('admin.lessonEditor.preview');
  if (blocks.length === 0) {
    return <p className="adm-preview__empty">{t('empty')}</p>;
  }
  return (
    <div className="adm-preview">
      {blocks.map((b) => {
        switch (b.type) {
          case 'heading':
            return b.level === 2 ? (
              <h2 key={b.id} className="adm-preview__h2">
                {b.text}
              </h2>
            ) : (
              <h3 key={b.id} className="adm-preview__h3">
                {b.text}
              </h3>
            );
          case 'text':
            return <Markdown key={b.id}>{b.markdown}</Markdown>;
          case 'divider':
            return <hr key={b.id} className="adm-preview__hr" />;
          case 'callout': {
            const Icon = TONE_ICON[b.tone];
            return (
              <div key={b.id} className={`adm-callout adm-callout--${b.tone}`}>
                <Icon aria-hidden="true" />
                <p>{b.text}</p>
              </div>
            );
          }
          case 'video':
            return (
              <figure key={b.id} className="adm-video">
                <div className="adm-video__frame">
                  <Play aria-hidden="true" />
                  <span>
                    {b.provider === 'youtube' && b.youtubeId ? t('youtube', { id: b.youtubeId }) : t('videoPlaceholder')}
                  </span>
                  {b.provider === 'youtube' && b.youtubeId && (
                    <a
                      href={`https://www.youtube.com/watch?v=${b.youtubeId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="adm-video__link"
                    >
                      {t('openYoutube')}
                    </a>
                  )}
                </div>
                {b.caption && <figcaption>{b.caption}</figcaption>}
              </figure>
            );
          case 'quiz':
            return (
              <section key={b.id} className="adm-quiz-preview" aria-label={t('quizTitle', { score: b.passScore })}>
                <h3 className="adm-quiz-preview__title">{t('quizTitle', { score: b.passScore })}</h3>
                <ol>
                  {b.questions.map((q) => (
                    <li key={q.id}>
                      <p className="adm-quiz-preview__q">{q.text || '…'}</p>
                      <ul className="adm-quiz-preview__options">
                        {q.options.map((o, i) => {
                          const right = q.correct.includes(i);
                          return (
                            <li key={i} className={right ? 'is-correct' : undefined}>
                              <span className={q.multiple ? 'adm-mark adm-mark--square' : 'adm-mark'} aria-hidden="true" />
                              <span>{o || '…'}</span>
                              {right && <em>{t('correct')}</em>}
                            </li>
                          );
                        })}
                      </ul>
                      {q.explain && (
                        <p className="adm-quiz-preview__explain">
                          <strong>{t('explain')}:</strong> {q.explain}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            );
          case 'image':
          case 'file':
            return null; // показ появится вместе с загрузкой файлов (D-034)
        }
      })}
    </div>
  );
}
