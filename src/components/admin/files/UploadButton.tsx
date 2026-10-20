'use client';
// Кнопка загрузки файла: выбор файла, XHR на /api/uploads с прогрессом, текст ошибки из files.errors.*.
// Флаги и лимиты приходят пропсами со страницы: клиент process.env не читает.
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/components/ui';
import { formatFileSize } from '@/lib/files/format';
import type { StoredFile } from '@/lib/files/types';
import './files.css';
import {
  acceptFor,
  parseUploadResponse,
  precheck,
  purposeOf,
  typesLabel,
  type UploadErrorView,
  type UploadKind,
  type UploadLimits,
} from './uploadModel';

type Props = {
  kind: UploadKind;
  courseId: string;
  /** Нужен для файлов урока; для обложки не передаётся. */
  lessonId?: string;
  limits: UploadLimits;
  /** Подпись кнопки. */
  label: string;
  /** Показать подсказку о типах и размере под кнопкой. */
  showHint?: boolean;
  /** Предупреждение о ПДн в демо (upload.demoWarning) рядом с кнопкой. */
  demoWarning?: boolean;
  variant?: 'chip' | 'primary' | 'ghost';
  disabled?: boolean;
  /** Файл загружен на сервер (в урок или обложкой он попадает отдельным шагом). */
  onUploaded: (file: StoredFile) => void | Promise<void>;
  testId?: string;
};

type Sent = { ok: true; file: StoredFile } | ({ ok: false } & UploadErrorView);

function send(file: File, url: string, onProgress: (percent: number) => void): Promise<Sent> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Upload-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => resolve({ ok: false, code: 'generic' });
    xhr.onabort = () => resolve({ ok: false, code: 'generic' });
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // не JSON (например, страница площадки): разберём по статусу
      }
      resolve(parseUploadResponse(xhr.status, body));
    };
    xhr.send(file);
  });
}

export function UploadButton({
  kind,
  courseId,
  lessonId,
  limits,
  label,
  showHint = false,
  demoWarning = false,
  variant = 'chip',
  disabled,
  onUploaded,
  testId,
}: Props) {
  const t = useTranslations('files');
  const locale = useLocale() === 'kz' ? 'kz' : 'ru';
  const input = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<UploadErrorView | null>(null);
  const busy = percent !== null;

  const units = { b: t('units.b'), kb: t('units.kb'), mb: t('units.mb'), gb: t('units.gb') };
  const size = (bytes: number) => formatFileSize(bytes, locale, units);

  const errorText = (e: UploadErrorView): string => {
    const key = `errors.${e.code}`;
    if (!t.has(key)) return t('errors.generic');
    const p = e.params ?? {};
    switch (e.code) {
      case 'too_large':
        return t(key, { size: size(typeof p.max === 'number' ? p.max : kind === 'file' ? limits.document : limits.image) });
      case 'bad_type':
        return t(key, { types: typesLabel(kind) });
      case 'image_too_large':
        return t(key, { max: typeof p.max === 'number' ? p.max : 10000 });
      default:
        return t(key);
    }
  };

  const hint =
    kind === 'file'
      ? t('upload.hintFile', { size: size(limits.document) })
      : kind === 'cover'
        ? t('upload.hintCover', { size: size(limits.image) })
        : t('upload.hintImage', { size: size(limits.image) });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const early = precheck(file, kind, limits);
    if (early) {
      setError(early);
      return;
    }
    const params = new URLSearchParams({ purpose: purposeOf(kind), courseId });
    if (lessonId) params.set('lessonId', lessonId);
    setPercent(0);
    const res = await send(file, `/api/uploads?${params.toString()}`, setPercent);
    if (res.ok) {
      try {
        await onUploaded(res.file);
      } catch {
        setError({ code: 'generic' });
      }
    } else {
      setError({ code: res.code, ...(res.params ? { params: res.params } : {}) });
    }
    setPercent(null);
  };

  const btnClass =
    variant === 'chip' ? 'chip' : cn('btn btn--sm', variant === 'primary' ? 'btn--primary' : 'btn--ghost');

  return (
    <div className="adm-upload">
      <input
        ref={input}
        type="file"
        hidden
        accept={acceptFor(kind)}
        tabIndex={-1}
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // тот же файл можно выбрать снова
          void pick(file);
        }}
      />
      <button
        type="button"
        className={btnClass}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        data-testid={testId}
        onClick={() => input.current?.click()}
      >
        {label}
      </button>
      {busy && (
        <p className="adm-upload__progress" role="status" data-testid="upload-progress">
          {t('upload.progress', { percent: percent ?? 0 })}
        </p>
      )}
      {error && (
        <p className="adm-upload__error" role="alert" data-testid="upload-error">
          {errorText(error)}
        </p>
      )}
      {showHint && !error && !busy && <p className="adm-upload__hint">{hint}</p>}
      {demoWarning && (
        <p className="adm-upload__demo" data-testid="upload-demo-warning">
          {t('upload.demoWarning')}
        </p>
      )}
    </div>
  );
}
