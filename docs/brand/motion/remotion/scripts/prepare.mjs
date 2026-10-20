// Готовит public/ перед студией и рендером: шрифты и логотип — копии из бренд-папок репозитория
// (единственный источник), звуковая дорожка — синтез ../sound.mjs по сигналам из src/timeline.ts.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAudio } from '../../sound.mjs';
import * as funnel from '../src/timeline.ts';
import * as funnel2 from '../src/funnel2/timeline.ts';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const repo = resolve(project, '../../../..');
const pub = join(project, 'public');

await mkdir(join(pub, 'fonts'), { recursive: true });
for (const font of ['Geologica-Bold-SHRP100.ttf', 'Onest-Regular.ttf', 'Onest-SemiBold.ttf']) {
  await copyFile(join(repo, 'assets/fonts/pdf', font), join(pub, 'fonts', font));
}
await copyFile(join(repo, 'docs/brand/logo/crp-logo-white.svg'), join(pub, 'crp-logo-white.svg'));
// Звук каждой композиции — из сигналов её же сценария.
for (const [name, { CUES, T }] of Object.entries({ funnel, funnel2 })) {
  await writeFile(join(pub, `sfx-${name}.wav`), renderAudio(CUES, T.total * 1000));
}
console.log('public/ готов: шрифты, логотип, звук');
