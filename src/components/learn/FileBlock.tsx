import { FileSpreadsheet, FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { FileBlock as FileBlockData, Locale } from '@/lib/content/types';
import { formatFileSize } from '@/lib/files/format';
import { fileUrl } from '@/lib/files/url';
import { FILE_TYPES } from '@/lib/storage/limits';
import './files.css';

const EXT_LABEL = { png: 'PNG', jpg: 'JPEG', webp: 'WebP', pdf: 'PDF', docx: 'DOCX', xlsx: 'XLSX' } as const;

type Props = {
  block: FileBlockData;
  locale: Locale;
  /** Демо, слушатель не админ (D-038): документ не выдаётся, вместо ссылки — нейтральная подпись. */
  hideDocument: boolean;
};

/** Файл для скачивания: плоская карточка без анимаций и теней (BRAND, «Без ИИ-шума»). */
export async function FileBlock({ block, locale, hideDocument }: Props) {
  const t = await getTranslations('files');
  const Icon = block.ext === 'xlsx' ? FileSpreadsheet : FileText;
  const title = block.label?.trim() || block.name;
  const meta = t('file.meta', {
    type: EXT_LABEL[block.ext],
    size: formatFileSize(block.sizeBytes, locale, {
      b: t('units.b'),
      kb: t('units.kb'),
      mb: t('units.mb'),
      gb: t('units.gb'),
    }),
  });
  // картинка в блоке «Файл» выдаётся по обычным правилам; прячем только документы
  const hidden = hideDocument && FILE_TYPES[block.ext].kind === 'document';

  return (
    <div className="lrn-file" data-testid="file-block">
      <Icon aria-hidden="true" className="lrn-file__icon" />
      <div className="lrn-file__body">
        <p className="lrn-file__title">{title}</p>
        <p className="lrn-file__meta">{meta}</p>
        {hidden && (
          <p className="lrn-file__note" data-testid="file-demo-hidden">
            {t('block.demoHidden')}
          </p>
        )}
      </div>
      {!hidden && (
        <a className="btn btn--ghost btn--sm lrn-file__action" href={fileUrl(block.fileId)} download={block.name} data-testid="file-download">
          {t('file.download')}
        </a>
      )}
    </div>
  );
}
