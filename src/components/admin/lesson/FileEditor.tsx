'use client';
// Редактор блока «Файл»: имя, тип и размер из загрузки; название для слушателя (пусто — имя файла).
import { useId } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui';
import { LIMITS } from '@/lib/content/blocks';
import type { FileBlock } from '@/lib/content/types';
import { formatFileSize } from '@/lib/files/format';
import { EXT_LABEL } from '../files/uploadModel';
import '../files/files.css';

type Props = { block: FileBlock; onChange: (next: FileBlock) => void; autoFocus?: boolean };

export function FileEditor({ block, onChange, autoFocus }: Props) {
  const t = useTranslations('files');
  const locale = useLocale() === 'kz' ? 'kz' : 'ru';
  const id = useId();
  const Icon = block.ext === 'xlsx' ? FileSpreadsheet : FileText;
  const size = formatFileSize(block.sizeBytes, locale, {
    b: t('units.b'),
    kb: t('units.kb'),
    mb: t('units.mb'),
    gb: t('units.gb'),
  });
  return (
    <div className="adm-fileedit">
      <div className="adm-filecard" data-testid="file-card">
        <Icon aria-hidden="true" />
        <div>
          <p className="adm-filecard__name">{block.name}</p>
          <p className="adm-filecard__meta">{t('file.meta', { type: EXT_LABEL[block.ext], size })}</p>
        </div>
      </div>
      <div className="adm-row">
        <label className="adm-row__label" htmlFor={`${id}-label`}>
          {t('file.label')}
        </label>
        <Input
          id={`${id}-label`}
          value={block.label ?? ''}
          maxLength={LIMITS.fileLabel}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ ...block, label: e.target.value })}
        />
        <p className="adm-row__hint">{t('file.labelHint')}</p>
      </div>
    </div>
  );
}
