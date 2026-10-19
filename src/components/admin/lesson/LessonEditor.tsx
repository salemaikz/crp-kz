'use client';
// Редактор урока: метаданные + контент ru/kz (блоки), живая проверка по схеме, сохранение через server action.
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Card, Field, Input, Select, Tabs, type TabItem } from '@/components/ui';
import { toContentIssues } from '@/lib/admin/contentIssues';
import type { ContentIssue, FieldErrors } from '@/lib/admin/errors';
import { addMissingKzQuizzes, kzQuizDiff, removeExtraKzQuizzes } from '@/lib/admin/kzQuizzes';
import type { ActionResult } from '@/lib/admin/result';
import { validateLessonContent } from '@/lib/content/blocks';
import type { Block } from '@/lib/content/types';
import { ErrorAlert } from '../ErrorAlert';
import { BlockListEditor } from './BlockListEditor';
import { BlockPreview } from './BlockPreview';
import { KzQuizMismatch } from './KzQuizMismatch';
import { cloneBlocks, normalizeBlocks } from './blockModel';

export type LessonEditorInitial = {
  titleRu: string;
  titleKz: string;
  slug: string;
  durationMin: string;
  status: 'draft' | 'published';
  ru: Block[];
  kz: Block[];
};

type Props = {
  initial: LessonEditorInitial;
  /** saveLessonAction с привязанными локалью, курсом и уроком. */
  save: (payload: unknown) => Promise<ActionResult<{ slug: string; savedAt: number }>>;
};

type Locale = 'ru' | 'kz';

function buildContent(ru: Block[], kz: Block[]) {
  return {
    ru: { v: 1, blocks: normalizeBlocks(ru) },
    ...(kz.length > 0 ? { kz: { v: 1, blocks: normalizeBlocks(kz) } } : {}),
  };
}

export function LessonEditor({ initial, save }: Props) {
  const t = useTranslations('admin.lessonEditor');
  const tf = useTranslations('admin.errors.field');
  const tEnum = useTranslations('admin.enums');

  const [meta, setMeta] = useState({
    titleRu: initial.titleRu,
    titleKz: initial.titleKz,
    slug: initial.slug,
    durationMin: initial.durationMin,
    status: initial.status,
  });
  const [ru, setRu] = useState<Block[]>(initial.ru);
  const [kz, setKz] = useState<Block[]>(initial.kz);
  const [tab, setTab] = useState<Locale>('ru');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(() => JSON.stringify({ meta, ru, kz }));
  const [justSaved, setJustSaved] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<ContentIssue[]>([]);
  const [serverFields, setServerFields] = useState<FieldErrors>({});

  const snapshot = JSON.stringify({ meta, ru, kz });
  const dirty = snapshot !== saved;

  // живая проверка по той же схеме, что на сервере — после первой попытки сохранить
  const liveIssues = useMemo<ContentIssue[]>(() => {
    if (!attempted) return [];
    const res = validateLessonContent(buildContent(ru, kz));
    return res.success ? [] : toContentIssues(res.error);
  }, [attempted, ru, kz]);
  const issues = serverIssues.length > 0 ? serverIssues : liveIssues;

  // правка после ошибки или успеха сбрасывает серверные подсказки и плашку «Сохранено»
  const touch = () => {
    setJustSaved(false);
    setErrorCode(null);
    if (serverIssues.length > 0) setServerIssues([]);
    if (Object.keys(serverFields).length > 0) setServerFields({});
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const metaError = (name: string): string | undefined => {
    const code = serverFields[name];
    return code ? (tf.has(code) ? tf(code) : tf('invalid')) : undefined;
  };

  const jumpToFirstIssue = (list: ContentIssue[]) => {
    const first = list.find((i) => (i.path[0] === 'ru' || i.path[0] === 'kz') && typeof i.path[2] === 'number');
    if (!first) return;
    const loc = first.path[0] as Locale;
    setMode('edit');
    setTab(loc);
    // дождаться перерисовки вкладки, затем прокрутить к блоку
    window.setTimeout(() => {
      document.getElementById(`block-${loc}-${first.path[2] as number}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  };

  const onSave = () => {
    if (pending) return;
    setAttempted(true);
    setJustSaved(false);
    setErrorCode(null);
    const sent = { meta, ru, kz };
    const payload = {
      titleRu: meta.titleRu,
      titleKz: meta.titleKz,
      slug: meta.slug,
      durationMin: meta.durationMin,
      status: meta.status,
      content: buildContent(ru, kz),
    };
    startTransition(async () => {
      let res: ActionResult<{ slug: string; savedAt: number }> | undefined;
      try {
        res = await save(payload);
      } catch {
        res = { ok: false, error: 'GENERIC' };
      }
      if (!res) return;
      if (res.ok) {
        setServerIssues([]);
        setServerFields({});
        setMeta((m) => ({ ...m, slug: res.slug }));
        // сервер мог оставить прежний slug — снимок «сохранённого» строим уже с ним
        setSaved(JSON.stringify({ meta: { ...sent.meta, slug: res.slug }, ru: sent.ru, kz: sent.kz }));
        setJustSaved(true);
      } else {
        setErrorCode(res.error);
        setServerIssues(res.issues ?? []);
        setServerFields(res.fields ?? {});
        jumpToFirstIssue(res.issues ?? []);
        // тесты казахской версии не совпадают с русскими — показать казахскую вкладку
        if (res.error === 'KZ_QUIZ_MISMATCH') {
          setMode('edit');
          setTab('kz');
        }
      }
    });
  };

  const copyFromRu = () => {
    if (kz.length > 0 && !window.confirm(t('content.copyConfirm'))) return;
    touch();
    setKz(cloneBlocks(ru));
  };

  // тесты kz против ru (D-020): недостающие дописываются копиями из ru, лишние убираются;
  // остальные блоки казахской версии не трогаем
  const kzDiff = useMemo(() => kzQuizDiff(ru, kz), [ru, kz]);
  const kzMismatch = kzDiff.missing.length > 0 || kzDiff.extra.length > 0;
  const kzMismatchError = errorCode === 'KZ_QUIZ_MISMATCH' && kzMismatch;
  const addMissingQuizzes = () => {
    touch();
    setKz(addMissingKzQuizzes(ru, kz));
  };
  const removeExtraQuizzes = () => {
    touch();
    setKz(removeExtraKzQuizzes(ru, kz));
  };

  const panel = (loc: Locale) => {
    const blocks = loc === 'ru' ? ru : kz;
    const setBlocks = (next: Block[]) => {
      touch();
      if (loc === 'ru') setRu(next);
      else setKz(next);
    };
    return (
      <div className="adm-locale-panel">
        {loc === 'kz' && (
          <div className="adm-kzbar">
            <p className="muted">{t('content.kzHint')}</p>
            <div className="adm-kzbar__actions">
              <Button type="button" size="sm" variant="ghost" onClick={copyFromRu} disabled={ru.length === 0} data-testid="copy-from-ru">
                {t('content.copyFromRu')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={addMissingQuizzes}
                disabled={kzDiff.missing.length === 0}
                data-testid="add-missing-quizzes"
              >
                {t('content.addMissingQuizzes')}
              </Button>
            </div>
          </div>
        )}
        {loc === 'kz' && kzMismatch && !kzMismatchError && (
          <KzQuizMismatch
            diff={kzDiff}
            tone="warning"
            testId="kz-quiz-hint"
            onAddMissing={addMissingQuizzes}
            onRemoveExtra={removeExtraQuizzes}
          />
        )}
        {mode === 'edit' ? (
          <BlockListEditor locale={loc} blocks={blocks} onChange={setBlocks} issues={issues} />
        ) : (
          <Card padding="lg" className="adm-preview-card">
            <p className="meta adm-preview-card__note">{t('preview.lead')}</p>
            <h2 className="adm-preview-card__title">{loc === 'kz' && meta.titleKz ? meta.titleKz : meta.titleRu}</h2>
            {loc === 'kz' && kz.length === 0 ? (
              <p className="adm-preview__empty">{t('preview.kzEmpty')}</p>
            ) : (
              <BlockPreview blocks={blocks} />
            )}
          </Card>
        )}
      </div>
    );
  };

  const tabs: TabItem[] = [
    { id: 'ru', label: t('content.ru'), count: ru.length, content: panel('ru') },
    { id: 'kz', label: t('content.kz'), count: kz.length, content: panel('kz') },
  ];

  const issueCount = issues.length;

  return (
    <div
      className="adm-editor"
      onKeyDown={(e) => {
        // Ctrl/Cmd+S — сохранить
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          onSave();
        }
      }}
    >
      <Card as="section" padding="lg" aria-labelledby="le-meta">
        <header className="adm-card__head">
          <h2 id="le-meta" className="h3">
            {t('meta.title')}
          </h2>
        </header>
        <div className="adm-grid-2">
          <Field label={t('meta.titleRu')} required error={metaError('titleRu')}>
            <Input
              name="titleRu"
              value={meta.titleRu}
              maxLength={200}
              onChange={(e) => {
                touch();
                setMeta({ ...meta, titleRu: e.target.value });
              }}
            />
          </Field>
          <Field label={t('meta.titleKz')} error={metaError('titleKz')}>
            <Input
              name="titleKz"
              value={meta.titleKz}
              maxLength={200}
              lang="kk"
              onChange={(e) => {
                touch();
                setMeta({ ...meta, titleKz: e.target.value });
              }}
            />
          </Field>
          <Field label={t('meta.slug')} hint={t('meta.slugHint')} error={metaError('slug')}>
            <Input
              name="slug"
              value={meta.slug}
              maxLength={60}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => {
                touch();
                setMeta({ ...meta, slug: e.target.value });
              }}
            />
          </Field>
          <div className="adm-grid-2 adm-grid-2--tight">
            <Field label={t('meta.duration')} error={metaError('durationMin')}>
              <Input
                name="durationMin"
                value={meta.durationMin}
                inputMode="numeric"
                onChange={(e) => {
                  touch();
                  setMeta({ ...meta, durationMin: e.target.value });
                }}
              />
            </Field>
            <Field label={t('meta.status')} hint={t('meta.statusHint')} error={metaError('status')}>
              <Select
                name="status"
                value={meta.status}
                onChange={(e) => {
                  touch();
                  setMeta({ ...meta, status: e.target.value === 'published' ? 'published' : 'draft' });
                }}
                data-testid="lesson-status"
              >
                <option value="draft">{tEnum('status.draft')}</option>
                <option value="published">{tEnum('status.published')}</option>
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card as="section" padding="lg" aria-labelledby="le-content">
        <header className="adm-card__head adm-card__head--row">
          <div>
            <h2 id="le-content" className="h3">
              {t('content.title')}
            </h2>
            <p className="muted">{t('content.lead')}</p>
          </div>
          <div className="adm-seg" role="radiogroup" aria-label={t('content.modeLabel')}>
            <button type="button" role="radio" aria-checked={mode === 'edit'} className="adm-seg__item" onClick={() => setMode('edit')}>
              {t('content.edit')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'preview'}
              className="adm-seg__item"
              onClick={() => setMode('preview')}
              data-testid="mode-preview"
            >
              {t('content.preview')}
            </button>
          </div>
        </header>
        <Tabs items={tabs} label={t('content.tabsLabel')} value={tab} onChange={(id) => setTab(id === 'kz' ? 'kz' : 'ru')} />
      </Card>

      <div className="adm-savebar" role="region" aria-label={t('save.region')}>
        <div className="adm-savebar__status" aria-live="polite">
          {kzMismatchError ? (
            <KzQuizMismatch
              diff={kzDiff}
              tone="error"
              testId="kz-quiz-error"
              onAddMissing={addMissingQuizzes}
              onRemoveExtra={removeExtraQuizzes}
            />
          ) : errorCode && !(errorCode === 'VALIDATION' && issueCount > 0) ? (
            <ErrorAlert code={errorCode} />
          ) : justSaved ? (
            <span className="adm-savebar__ok" data-testid="lesson-saved">
              <Check aria-hidden="true" /> {t('save.saved')}
            </span>
          ) : issueCount > 0 ? (
            <span className="adm-savebar__warn">{t('save.issues', { count: issueCount })}</span>
          ) : dirty ? (
            <span className="adm-savebar__dirty">{t('save.dirty')}</span>
          ) : null /* открыт без правок — статус пуст: «сохранено» показываем только после сохранения в этой сессии */}
        </div>
        <div className="adm-savebar__actions">
          <Button type="button" onClick={onSave} disabled={pending} aria-busy={pending || undefined} data-testid="lesson-save">
            {pending ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {t('save.saving')}
              </>
            ) : (
              t('save.submit')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
