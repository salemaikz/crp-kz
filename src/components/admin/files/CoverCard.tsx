'use client';
// Обложка курса: превью 16:9, «Загрузить» / «Заменить», «Убрать обложку». Загруженный файл
// становится обложкой сразу, отдельным действием setCourseCoverAction.
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { clearCourseCoverAction, setCourseCoverAction } from '@/lib/files/actions';
import { fileUrl } from '@/lib/files/url';
import { ActionButton } from '../ActionButton';
import { UploadButton } from './UploadButton';
import type { UploadLimits } from './uploadModel';
import './files.css';

type Props = {
  locale: 'ru' | 'kz';
  courseId: string;
  /** id файла текущей обложки; null — обложки нет. */
  coverFileId: string | null;
  limits: UploadLimits;
  /** Хранилище настроено; иначе вместо кнопок — errors.storage_unavailable. */
  storageOk: boolean;
  demo: boolean;
};

export function CoverCard({ locale, courseId, coverFileId, limits, storageOk, demo }: Props) {
  const t = useTranslations('files');
  const terr = useTranslations('admin.errors');
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCover = (fileId: string): Promise<void> =>
    new Promise((resolve) => {
      setSaved(false);
      setError(null);
      startTransition(async () => {
        try {
          const res = await setCourseCoverAction(locale, courseId, fileId);
          if (res.ok) setSaved(true);
          else setError(res.error);
        } catch {
          setError('GENERIC');
        }
        resolve();
      });
    });

  return (
    <Card as="section" padding="lg" aria-labelledby="cover-title" className="adm-cover" data-testid="cover-card">
      <header className="adm-card__head">
        <h2 id="cover-title" className="h3">
          {t('cover.title')}
        </h2>
      </header>
      {coverFileId ? (
        <div className="adm-cover__preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- превью из выдачи с проверкой доступа */}
          <img src={fileUrl(coverFileId)} alt="" data-testid="cover-preview" />
        </div>
      ) : (
        <p className="muted" data-testid="cover-empty">
          {t('cover.empty')}
        </p>
      )}
      {storageOk ? (
        <div className="adm-cover__actions">
          <UploadButton
            kind="cover"
            courseId={courseId}
            limits={limits}
            label={coverFileId ? t('upload.replace') : t('cover.upload')}
            variant={coverFileId ? 'ghost' : 'primary'}
            showHint
            demoWarning={demo}
            onUploaded={(f) => setCover(f.id)}
            testId="cover-upload"
          />
          {coverFileId && (
            <ActionButton
              variant="text"
              tone="danger"
              label={t('cover.remove')}
              action={() => {
                // прежние «сохранено» и ошибка к убранной обложке не относятся
                setSaved(false);
                setError(null);
                return clearCourseCoverAction(locale, courseId);
              }}
              testId="cover-remove"
            />
          )}
        </div>
      ) : (
        <p className="adm-upload__error">{t('errors.storage_unavailable')}</p>
      )}
      {saved && coverFileId && (
        <p className="adm-cover__saved" role="status" data-testid="cover-saved">
          {t('cover.saved')}
        </p>
      )}
      {error && (
        <p className="adm-upload__error" role="alert">
          {terr.has(error) ? terr(error) : terr('GENERIC')}
        </p>
      )}
    </Card>
  );
}
