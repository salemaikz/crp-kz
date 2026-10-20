/**
 * Настройки CLI для студии и рендера. Для Node API не действуют.
 * Все опции: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
// PNG без потерь: на плоских цветах доски JPEG даёт заметные артефакты.
Config.setVideoImageFormat("png");
Config.setCodec("h264");
Config.setCrf(16);
Config.setPixelFormat("yuv420p");
// BT.709 — как ждут плееры и соцсети, иначе фирменный красный уходит в оранжевый.
Config.setColorSpace("bt709");
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);
