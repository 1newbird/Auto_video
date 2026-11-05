import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoOptions} from '../runtime/scripts/lib/video-options.mjs';

export const settingsPath=fileURLToPath(new URL('../settings.json',import.meta.url));

export async function resolveVideoOptions(overrides={},configFile=settingsPath) {
  const config=JSON.parse((await fs.readFile(configFile,'utf8')).replace(/^\uFEFF/,''));
  return videoOptions(overrides.quality===undefined?config['清晰度']:overrides.quality,
    overrides.fps===undefined?config['帧率']:overrides.fps);
}

export async function resolveOutputDir(override,configFile=settingsPath) {
  if(override!==undefined) {
    if(typeof override!=='string'||!override.trim())throw new Error('Output directory must be a nonempty string');
    return path.resolve(override);
  }
  const config=JSON.parse((await fs.readFile(configFile,'utf8')).replace(/^\uFEFF/,''));
  if(typeof config?.outputDir!=='string'||!config.outputDir.trim())throw new Error(`Invalid outputDir in ${configFile}`);
  return path.resolve(path.dirname(configFile),config.outputDir.trim());
}
