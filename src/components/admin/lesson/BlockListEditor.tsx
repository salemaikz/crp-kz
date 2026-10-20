'use client';
// Список блоков одной локали: карточки блоков с перестановкой и удалением, панель «Добавить блок».
import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ContentIssue } from '@/lib/admin/errors';
import type { Block } from '@/lib/content/types';
import { formatFileSize } from '@/lib/files/format';
import type { StoredFile } from '@/lib/files/types';
import { UploadButton } from '../files/UploadButton';
import type { LessonUploads } from '../files/uploadModel';
import { BLOCK_TYPES, moved, newBlock, newFileBlock, newImageBlock, type AddableBlockType } from './blockModel';
import { CalloutEditor, DividerEditor, HeadingEditor, QuizEditor, TextEditor, VideoEditor } from './BlockEditors';
import { FileEditor } from './FileEditor';
import { ImageEditor } from './ImageEditor';
import { describeIssue, issuesForBlock } from './issueText';

type Props = {
  locale: 'ru' | 'kz';
  blocks: Block[];
  /** Список или функция от актуального списка (нужна для загрузок, завершающихся позже рендера). */
  onChange: (next: Block[] | ((prev: Block[]) => Block[])) => void;
  issues: readonly ContentIssue[];
  /** Загрузка файлов: нет — кнопок «Изображение» и «Файл» нет. */
  uploads?: LessonUploads;
};

function BlockBody({
  block,
  onChange,
  autoFocus,
  uploads,
}: {
  block: Block;
  onChange: (b: Block) => void;
  autoFocus: boolean;
  uploads?: LessonUploads;
}) {
  switch (block.type) {
    case 'heading':
      return <HeadingEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'text':
      return <TextEditor block={block} onChange={onChange} autoFocus={autoFocus} uploads={uploads} />;
    case 'video':
      return <VideoEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'callout':
      return <CalloutEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'quiz':
      return <QuizEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'divider':
      return <DividerEditor />;
    case 'image':
      return <ImageEditor block={block} onChange={onChange} preview={uploads?.enabled === true} autoFocus={autoFocus} />;
    case 'file':
      return <FileEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
  }
}

export function BlockListEditor({ locale, blocks, onChange, issues, uploads }: Props) {
  const t = useTranslations('admin.lessonEditor');
  const tf = useTranslations('files');
  const appLocale = useLocale() === 'kz' ? 'kz' : 'ru';
  const ti = useTranslations('admin.lessonEditor.issue');
  const [focusId, setFocusId] = useState<string | null>(null);

  const add = (type: AddableBlockType) => {
    const b = newBlock(type);
    setFocusId(b.id);
    onChange((prev) => [...prev, b]);
  };
  // блок из загруженного файла; файл попадает в урок только после «Сохранить»
  const addUploaded = (make: (f: StoredFile) => Block) => (f: StoredFile) => {
    const b = make(f);
    setFocusId(b.id);
    onChange((prev) => [...prev, b]);
  };
  const sizeOf = (bytes: number) =>
    formatFileSize(bytes, appLocale, { b: tf('units.b'), kb: tf('units.kb'), mb: tf('units.mb'), gb: tf('units.gb') });
  const fieldLabels = { alt: tf('image.alt'), label: tf('file.label') };
  // по id и от актуального списка, а не по индексу из замыкания
  const replace = (id: string, next: Block) => onChange((prev) => prev.map((b) => (b.id === id ? next : b)));

  return (
    <div className="adm-blocks" data-locale={locale}>
      {blocks.length === 0 ? (
        <div className="adm-blocks__empty">
          <p>
            <strong>{t('blocks.emptyTitle')}</strong>
          </p>
          <p className="muted">{t('blocks.emptyText')}</p>
        </div>
      ) : (
        <ol className="adm-blocklist">
          {blocks.map((b, i) => {
            const own = issuesForBlock(issues, locale, i);
            return (
              <li
                key={b.id}
                id={`block-${locale}-${i}`}
                className={own.length > 0 ? 'adm-block adm-block--invalid' : 'adm-block'}
                data-block-type={b.type}
                aria-label={`${t(`blocks.types.${b.type}`)} ${i + 1}`}
              >
                <div className="adm-block__bar">
                  <span className="adm-block__type">
                    {t(`blocks.types.${b.type}`)}
                    <span className="adm-block__no">#{i + 1}</span>
                  </span>
                  <div className="adm-block__tools">
                    <button
                      type="button"
                      className="adm-iconbtn adm-iconbtn--sm"
                      onClick={() => {
                        const order = moved(blocks, i, 'up');
                        if (order) onChange(order);
                      }}
                      disabled={i === 0}
                      aria-label={t('blocks.up')}
                      title={t('blocks.up')}
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="adm-iconbtn adm-iconbtn--sm"
                      onClick={() => {
                        const order = moved(blocks, i, 'down');
                        if (order) onChange(order);
                      }}
                      disabled={i === blocks.length - 1}
                      aria-label={t('blocks.down')}
                      title={t('blocks.down')}
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="adm-iconbtn adm-iconbtn--sm adm-iconbtn--danger"
                      onClick={() => {
                        if (b.type === 'divider' || window.confirm(t('blocks.deleteConfirm'))) {
                          onChange(blocks.filter((_, k) => k !== i));
                        }
                      }}
                      aria-label={t('blocks.delete')}
                      title={t('blocks.delete')}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="adm-block__body">
                  <BlockBody block={b} onChange={(next) => replace(b.id, next)} autoFocus={focusId === b.id} uploads={uploads} />
                </div>
                {own.length > 0 && (
                  <ul className="adm-block__errors" role="alert">
                    {own.map((issue, k) => (
                      <li key={k}>{describeIssue(issue, ti, fieldLabels)}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="adm-addblock" role="group" aria-label={t('blocks.add')}>
        <span className="adm-addblock__label">{t('blocks.add')}</span>
        {BLOCK_TYPES.map((type) => (
          <button key={type} type="button" className="chip" onClick={() => add(type)} data-testid={`add-block-${type}`}>
            {t(`blocks.types.${type}`)}
          </button>
        ))}
        {uploads?.enabled && uploads.storageOk && (
          <>
            <UploadButton
              kind="image"
              courseId={uploads.courseId}
              lessonId={uploads.lessonId}
              limits={uploads.limits}
              label={t('blocks.types.image')}
              onUploaded={addUploaded(newImageBlock)}
              testId="add-block-image"
            />
            <UploadButton
              kind="file"
              courseId={uploads.courseId}
              lessonId={uploads.lessonId}
              limits={uploads.limits}
              label={t('blocks.types.file')}
              onUploaded={addUploaded(newFileBlock)}
              testId="add-block-file"
            />
          </>
        )}
        {uploads?.enabled && uploads.storageOk && (
          <div className="adm-upload__hint adm-addblock__demo">
            <p>{tf('upload.hintImage', { size: sizeOf(uploads.limits.image) })}</p>
            <p>{tf('upload.hintFile', { size: sizeOf(uploads.limits.document) })}</p>
          </div>
        )}
        {uploads?.enabled && uploads.storageOk && uploads.demo && (
          <p className="adm-upload__demo adm-addblock__demo" data-testid="upload-demo-warning">
            {tf('upload.demoWarning')}
          </p>
        )}
        {uploads?.enabled && !uploads.storageOk && (
          <p className="adm-upload__error adm-addblock__demo">{tf('errors.storage_unavailable')}</p>
        )}
      </div>
    </div>
  );
}
