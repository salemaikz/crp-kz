'use client';
// Список блоков одной локали: карточки блоков с перестановкой и удалением, панель «Добавить блок».
import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CircleHelp,
  Heading2,
  Info,
  Minus,
  Play,
  Plus,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ContentIssue } from '@/lib/admin/errors';
import type { Block } from '@/lib/content/types';
import { BLOCK_TYPES, moved, newBlock, type BlockType } from './blockModel';
import { CalloutEditor, DividerEditor, HeadingEditor, QuizEditor, TextEditor, VideoEditor } from './BlockEditors';
import { describeIssue, issuesForBlock } from './issueText';

const ICONS: Record<BlockType, LucideIcon> = {
  heading: Heading2,
  text: Type,
  video: Play,
  callout: Info,
  divider: Minus,
  quiz: CircleHelp,
};

type Props = {
  locale: 'ru' | 'kz';
  blocks: Block[];
  onChange: (next: Block[]) => void;
  issues: readonly ContentIssue[];
};

function BlockBody({ block, onChange, autoFocus }: { block: Block; onChange: (b: Block) => void; autoFocus: boolean }) {
  switch (block.type) {
    case 'heading':
      return <HeadingEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'text':
      return <TextEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'video':
      return <VideoEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'callout':
      return <CalloutEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'quiz':
      return <QuizEditor block={block} onChange={onChange} autoFocus={autoFocus} />;
    case 'divider':
      return <DividerEditor />;
  }
}

export function BlockListEditor({ locale, blocks, onChange, issues }: Props) {
  const t = useTranslations('admin.lessonEditor');
  const ti = useTranslations('admin.lessonEditor.issue');
  const [focusId, setFocusId] = useState<string | null>(null);

  const add = (type: BlockType) => {
    const b = newBlock(type);
    setFocusId(b.id);
    onChange([...blocks, b]);
  };
  const replace = (i: number, next: Block) => onChange(blocks.map((b, k) => (k === i ? next : b)));

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
            const Icon = ICONS[b.type];
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
                    <Icon aria-hidden="true" />
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
                  <BlockBody block={b} onChange={(next) => replace(i, next)} autoFocus={focusId === b.id} />
                </div>
                {own.length > 0 && (
                  <ul className="adm-block__errors" role="alert">
                    {own.map((issue, k) => (
                      <li key={k}>{describeIssue(issue, ti)}</li>
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
        {BLOCK_TYPES.map((type) => {
          const Icon = ICONS[type];
          return (
            <button key={type} type="button" className="chip" onClick={() => add(type)} data-testid={`add-block-${type}`}>
              <Plus aria-hidden="true" className="adm-addblock__plus" />
              <Icon aria-hidden="true" />
              {t(`blocks.types.${type}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
