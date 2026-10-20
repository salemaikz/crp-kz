import type { ImageBlock as ImageBlockData } from '@/lib/content/types';
import { fileUrl } from '@/lib/files/url';
import './files.css';

/**
 * Изображение урока: размеры из снимка в блоке не дают странице прыгать при загрузке.
 * Адрес выдаёт /api/files/<id>: доступ к картинке проверяется там, а не здесь.
 */
export function ImageBlock({ block }: { block: ImageBlockData }) {
  return (
    <figure className="lrn-figure lrn-image" data-testid="image-block">
      {/* eslint-disable-next-line @next/next/no-img-element -- адрес выдачи с проверкой доступа, оптимизатор не нужен */}
      <img src={fileUrl(block.fileId)} width={block.width} height={block.height} alt={block.alt} loading="lazy" />
      {block.caption && <figcaption className="lrn-figcaption">{block.caption}</figcaption>}
    </figure>
  );
}
