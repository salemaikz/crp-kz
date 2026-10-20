'use client';
// Редактор блока «Изображение»: превью, обязательный текст вместо изображения, подпись.
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui';
import { LIMITS } from '@/lib/content/blocks';
import type { ImageBlock } from '@/lib/content/types';
import { fileUrl } from '@/lib/files/url';
import '../files/files.css';

type Props = {
  block: ImageBlock;
  onChange: (next: ImageBlock) => void;
  /** UPLOADS активен: без флага адрес /api/files/ вернёт 404, превью не показываем. */
  preview: boolean;
  autoFocus?: boolean;
};

export function ImageEditor({ block, onChange, preview, autoFocus }: Props) {
  const t = useTranslations('files.image');
  const id = useId();
  return (
    <div className="adm-imageedit">
      {preview && (
        <div className="adm-imageedit__preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- превью из выдачи с проверкой доступа */}
          <img src={fileUrl(block.fileId)} alt={block.alt} data-testid="image-preview" />
        </div>
      )}
      <div className="adm-row-group">
        <div className="adm-row">
          <label className="adm-row__label" htmlFor={`${id}-alt`}>
            {t('alt')}
          </label>
          <Input
            id={`${id}-alt`}
            value={block.alt}
            maxLength={LIMITS.imageAlt}
            autoFocus={autoFocus}
            required
            data-testid="image-alt"
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
          />
          <p className="adm-row__hint">{t('altHint')}</p>
        </div>
        <div className="adm-row">
          <label className="adm-row__label" htmlFor={`${id}-cap`}>
            {t('caption')}
          </label>
          <Input
            id={`${id}-cap`}
            value={block.caption ?? ''}
            maxLength={LIMITS.caption}
            onChange={(e) => onChange({ ...block, caption: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
