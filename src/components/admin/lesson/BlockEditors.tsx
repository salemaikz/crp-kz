'use client';
// Редакторы блоков по типам: заголовок, текст (Markdown + предпросмотр), видео, выноска, тест.
import { useId, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Checkbox, Input, Select, Textarea } from '@/components/ui';
import type {
  CalloutBlock,
  HeadingBlock,
  QuizBlock,
  QuizQuestion,
  TextBlock,
  VideoBlock,
} from '@/lib/content/types';
import { LIMITS } from '@/lib/content/blocks';
import { moved, newQuestion, parseYoutubeId } from './blockModel';
import { Markdown } from './Markdown';

type EditorProps<B> = { block: B; onChange: (next: B) => void; autoFocus?: boolean };

/** Поле с подписью внутри блока (компактнее общего Field). */
function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="adm-row">
      <label className="adm-row__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="adm-row__hint">{hint}</p>}
    </div>
  );
}

export function HeadingEditor({ block, onChange, autoFocus }: EditorProps<HeadingBlock>) {
  const t = useTranslations('admin.lessonEditor.heading');
  const id = useId();
  return (
    <div className="adm-row-group adm-row-group--heading">
      <Row label={t('level')} htmlFor={`${id}-level`}>
        <Select
          id={`${id}-level`}
          value={block.level}
          onChange={(e) => onChange({ ...block, level: Number(e.target.value) === 3 ? 3 : 2 })}
        >
          <option value={2}>{t('h2')}</option>
          <option value={3}>{t('h3')}</option>
        </Select>
      </Row>
      <Row label={t('text')} htmlFor={`${id}-text`}>
        <Input
          id={`${id}-text`}
          value={block.text}
          maxLength={LIMITS.headingText}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
        />
      </Row>
    </div>
  );
}

export function TextEditor({ block, onChange, autoFocus }: EditorProps<TextBlock>) {
  const t = useTranslations('admin.lessonEditor.text');
  const id = useId();
  return (
    <div className="adm-split">
      <Row label={t('label')} hint={t('hint')} htmlFor={`${id}-md`}>
        <Textarea
          id={`${id}-md`}
          className="adm-mono"
          rows={10}
          value={block.markdown}
          maxLength={LIMITS.markdown}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ ...block, markdown: e.target.value })}
        />
      </Row>
      <div className="adm-split__preview">
        <span className="adm-row__label">{t('preview')}</span>
        <div className="adm-split__paper" aria-live="off">
          {block.markdown.trim() ? <Markdown>{block.markdown}</Markdown> : <p className="adm-preview__empty">{t('previewEmpty')}</p>}
        </div>
      </div>
    </div>
  );
}

export function VideoEditor({ block, onChange, autoFocus }: EditorProps<VideoBlock>) {
  const t = useTranslations('admin.lessonEditor.video');
  const id = useId();
  // то, что ввёл человек (ссылка целиком); в блок пишем разобранный ID
  const [raw, setRaw] = useState(block.youtubeId ?? '');
  const parsed = raw.trim() ? parseYoutubeId(raw) : null;

  const setRawValue = (value: string) => {
    setRaw(value);
    const idValue = parseYoutubeId(value);
    onChange({ ...block, youtubeId: idValue ?? value.trim() });
  };

  return (
    <div className="adm-row-group">
      <Row label={t('provider')} htmlFor={`${id}-provider`}>
        <Select
          id={`${id}-provider`}
          value={block.provider}
          autoFocus={autoFocus}
          onChange={(e) => {
            const provider = e.target.value === 'youtube' ? 'youtube' : 'placeholder';
            onChange({ ...block, provider });
          }}
        >
          <option value="placeholder">{t('placeholder')}</option>
          <option value="youtube">{t('youtube')}</option>
        </Select>
      </Row>
      {block.provider === 'youtube' && (
        <Row label={t('youtubeId')} hint={parsed ? t('recognized', { id: parsed }) : t('youtubeHint')} htmlFor={`${id}-yt`}>
          <Input
            id={`${id}-yt`}
            value={raw}
            placeholder="https://youtu.be/…"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={raw.trim() !== '' && !parsed ? true : undefined}
            onChange={(e) => setRawValue(e.target.value)}
          />
        </Row>
      )}
      <Row label={t('caption')} htmlFor={`${id}-cap`}>
        <Input
          id={`${id}-cap`}
          value={block.caption ?? ''}
          maxLength={LIMITS.caption}
          onChange={(e) => onChange({ ...block, caption: e.target.value })}
        />
      </Row>
    </div>
  );
}

const TONES: CalloutBlock['tone'][] = ['info', 'warn', 'success'];

export function CalloutEditor({ block, onChange, autoFocus }: EditorProps<CalloutBlock>) {
  const t = useTranslations('admin.lessonEditor.callout');
  const id = useId();
  return (
    <div className="adm-row-group">
      <Row label={t('tone')}>
        <div className="adm-seg" role="radiogroup" aria-label={t('tone')}>
          {TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              role="radio"
              aria-checked={block.tone === tone}
              className={`adm-seg__item adm-seg__item--${tone}`}
              onClick={() => onChange({ ...block, tone })}
            >
              {t(tone)}
            </button>
          ))}
        </div>
      </Row>
      <Row label={t('text')} htmlFor={`${id}-text`}>
        <Textarea
          id={`${id}-text`}
          rows={3}
          value={block.text}
          maxLength={LIMITS.calloutText}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
        />
      </Row>
    </div>
  );
}

export function DividerEditor() {
  const t = useTranslations('admin.lessonEditor');
  return <p className="adm-divider-note">{t('divider.note')}</p>;
}

// ---------- тест ----------

function QuestionEditor({
  q,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  autoFocus,
}: {
  q: QuizQuestion;
  index: number;
  total: number;
  onChange: (next: QuizQuestion) => void;
  onMove: (dir: 'up' | 'down') => void;
  onRemove: () => void;
  autoFocus?: boolean;
}) {
  const t = useTranslations('admin.lessonEditor.quiz');
  const id = useId();

  const setCorrect = (i: number, checked: boolean) => {
    if (!q.multiple) return onChange({ ...q, correct: [i] });
    const set = new Set(q.correct);
    if (checked) set.add(i);
    else set.delete(i);
    onChange({ ...q, correct: [...set].sort((a, b) => a - b) });
  };
  const setOption = (i: number, value: string) => onChange({ ...q, options: q.options.map((o, k) => (k === i ? value : o)) });
  const addOption = () => onChange({ ...q, options: [...q.options, ''] });
  const removeOption = (i: number) =>
    onChange({
      ...q,
      options: q.options.filter((_, k) => k !== i),
      // индексы правильных сдвигаются вместе с вариантами
      correct: q.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)),
    });
  const setMultiple = (multiple: boolean) =>
    onChange({ ...q, multiple, correct: multiple ? q.correct : q.correct.slice(0, 1) });

  return (
    <li className="adm-question">
      <div className="adm-question__bar">
        <strong>{t('question', { n: index + 1 })}</strong>
        <div className="adm-question__tools">
          <button type="button" className="adm-iconbtn adm-iconbtn--sm" onClick={() => onMove('up')} disabled={index === 0} aria-label={t('questionUp')} title={t('questionUp')}>
            <ArrowUp aria-hidden="true" />
          </button>
          <button type="button" className="adm-iconbtn adm-iconbtn--sm" onClick={() => onMove('down')} disabled={index === total - 1} aria-label={t('questionDown')} title={t('questionDown')}>
            <ArrowDown aria-hidden="true" />
          </button>
          <button type="button" className="adm-iconbtn adm-iconbtn--sm adm-iconbtn--danger" onClick={onRemove} disabled={total <= 1} aria-label={t('removeQuestion')} title={t('removeQuestion')}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </div>

      <Row label={t('questionText')} htmlFor={`${id}-text`}>
        <Textarea
          id={`${id}-text`}
          rows={2}
          value={q.text}
          maxLength={LIMITS.questionText}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ ...q, text: e.target.value })}
        />
      </Row>

      <fieldset className="adm-options">
        <legend className="adm-row__label">{q.multiple ? t('optionsMulti') : t('optionsSingle')}</legend>
        {q.options.map((o, i) => (
          <div key={i} className="adm-option">
            <input
              type={q.multiple ? 'checkbox' : 'radio'}
              name={`${id}-correct`}
              checked={q.correct.includes(i)}
              onChange={(e) => setCorrect(i, e.target.checked)}
              aria-label={t('markCorrect', { n: i + 1 })}
              title={t('markCorrect', { n: i + 1 })}
            />
            <Input
              value={o}
              maxLength={LIMITS.optionText}
              placeholder={t('option', { n: i + 1 })}
              aria-label={t('option', { n: i + 1 })}
              onChange={(e) => setOption(i, e.target.value)}
            />
            <button
              type="button"
              className="adm-iconbtn adm-iconbtn--sm adm-iconbtn--danger"
              onClick={() => removeOption(i)}
              disabled={q.options.length <= LIMITS.optionsMin}
              aria-label={t('removeOption', { n: i + 1 })}
              title={t('removeOption', { n: i + 1 })}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="adm-options__foot">
          <button type="button" className="adm-linkbtn" onClick={addOption} disabled={q.options.length >= LIMITS.optionsMax}>
            <Plus aria-hidden="true" /> {t('addOption')}
          </button>
          {q.correct.length === 0 && <span className="adm-options__warn">{t('noCorrect')}</span>}
        </div>
      </fieldset>

      <Checkbox
        checked={q.multiple}
        onChange={(e) => setMultiple(e.target.checked)}
        label={t('multiple')}
        className="adm-question__multi"
      />

      <Row label={t('explain')} hint={t('explainHint')} htmlFor={`${id}-explain`}>
        <Textarea
          id={`${id}-explain`}
          rows={2}
          value={q.explain ?? ''}
          maxLength={LIMITS.explain}
          onChange={(e) => onChange({ ...q, explain: e.target.value })}
        />
      </Row>
    </li>
  );
}

export function QuizEditor({ block, onChange, autoFocus }: EditorProps<QuizBlock>) {
  const t = useTranslations('admin.lessonEditor.quiz');
  const id = useId();
  const setQuestion = (i: number, next: QuizQuestion) =>
    onChange({ ...block, questions: block.questions.map((q, k) => (k === i ? next : q)) });

  return (
    <div className="adm-row-group">
      <Row label={t('passScore')} hint={t('passHint')} htmlFor={`${id}-pass`}>
        <Input
          id={`${id}-pass`}
          type="number"
          min={1}
          max={100}
          inputMode="numeric"
          value={Number.isFinite(block.passScore) ? block.passScore : ''}
          className="adm-input--short"
          onChange={(e) => onChange({ ...block, passScore: e.target.value === '' ? NaN : Number(e.target.value) })}
        />
      </Row>
      <ol className="adm-questions">
        {block.questions.map((q, i) => (
          <QuestionEditor
            key={q.id}
            q={q}
            index={i}
            total={block.questions.length}
            autoFocus={autoFocus && i === 0}
            onChange={(next) => setQuestion(i, next)}
            onMove={(dir) => {
              const order = moved(block.questions, i, dir);
              if (order) onChange({ ...block, questions: order });
            }}
            onRemove={() => onChange({ ...block, questions: block.questions.filter((_, k) => k !== i) })}
          />
        ))}
      </ol>
      <div>
        <button
          type="button"
          className="adm-addrow"
          onClick={() => onChange({ ...block, questions: [...block.questions, newQuestion()] })}
          disabled={block.questions.length >= LIMITS.questionsMax}
        >
          <Plus aria-hidden="true" /> {t('addQuestion')}
        </button>
      </div>
    </div>
  );
}
