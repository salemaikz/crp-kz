import { Composition } from 'remotion';
import { Funnel } from './Funnel';
import { Funnel2 } from './funnel2/Funnel2';
import * as v1 from './timeline';
import * as v2 from './funnel2/timeline';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Funnel" component={Funnel} durationInFrames={v1.frames(v1.T.total)} fps={v1.FPS} width={v1.WIDTH} height={v1.HEIGHT} />
    <Composition id="Funnel2" component={Funnel2} durationInFrames={v2.frames(v2.T.total)} fps={v2.FPS} width={v2.WIDTH} height={v2.HEIGHT} />
  </>
);
