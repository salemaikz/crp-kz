import { Play } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { VideoBlock as VideoBlockData } from '@/lib/content/types';
import './learn.css';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Видео урока. YouTube — через youtube-nocookie в iframe 16:9; заглушка — постер
 * «Видео появится после загрузки материалов ЦРП» (реальные ролики подключит ЦРП).
 */
export async function VideoBlock({ block, title }: { block: VideoBlockData; title: string }) {
  const t = await getTranslations('learn.video');
  const youtubeId = block.provider === 'youtube' && block.youtubeId && YOUTUBE_ID.test(block.youtubeId) ? block.youtubeId : null;
  return (
    <figure className="lrn-figure">
      {youtubeId ? (
        <div className="lrn-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0`}
            title={block.caption || title}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <div className="lrn-video lrn-video--poster" role="img" aria-label={t('placeholder')}>
          <div className="lrn-video__inner">
            <span className="lrn-video__play" aria-hidden="true">
              <Play />
            </span>
            <p className="lrn-video__note">{t('placeholder')}</p>
          </div>
        </div>
      )}
      {block.caption && <figcaption className="lrn-figcaption">{block.caption}</figcaption>}
    </figure>
  );
}
