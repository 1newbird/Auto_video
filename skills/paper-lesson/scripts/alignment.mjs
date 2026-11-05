import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {storageEnvironment,assertWithinOutput} from './storage.mjs';
import {checkAudio,parseSrt} from '../runtime/scripts/lib/audio.mjs';
import {validateWordTimings} from '../runtime/scripts/lib/word-timing.mjs';
import {groupWordCues,wordTimingsFromGroups} from '../runtime/scripts/lib/word-srt.mjs';
import {hash} from '../runtime/scripts/lib/text.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(exe,args,env,cwd) {
  return new Promise((resolve,reject)=>{const child=spawn(exe,args,{env,cwd,windowsHide:true,shell:false,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Word alignment command exited ${code}; existing files retained, no timing approximation used`)));});
}
export async function ensureWordAlignment({job,outputRoot,python,importFile,refresh=false}) {
  const source=JSON.parse(await fs.readFile(path.join(job,'source.json'),'utf8'));
  if(source.timingMode!=='subtitles')return null;
  await assertWithinOutput(job,source.audio.path);await checkAudio(source.audio);
  const dest=path.join(job,'word-timings.json');
  if(importFile) {
    const data=validateWordTimings(source,JSON.parse((await fs.readFile(importFile,'utf8')).replace(/^\uFEFF/,'')));
    await fs.writeFile(dest,JSON.stringify(data,null,2));console.log('Imported word timings.');return dest;
  }
  if(existsSync(dest)&&!refresh) {
    validateWordTimings(source,JSON.parse(await fs.readFile(dest,'utf8')));
    console.log('Reusing saved word timings (no audio model run).');return dest;
  }
  if(source.subtitles?.precision==='word') {
    await assertWithinOutput(job,source.subtitles.path);
    const raw=await fs.readFile(source.subtitles.path,'utf8');
    if(hash(raw)!==source.subtitles.sha256)throw new Error('Saved word SRT changed; prepare a new job with matching inputs');
    const data=wordTimingsFromGroups(source,groupWordCues(parseSrt(raw)));
    await fs.writeFile(dest,JSON.stringify(data,null,2));
    console.log('Imported saved word SRT (no audio model run).');return dest;
  }
  const home=path.join(outputRoot,'.paper-lesson-align');await assertWithinOutput(outputRoot,home);
  const env={...process.env,...await storageEnvironment(home),PYTHONUTF8:'1',HF_HOME:path.join(home,'hf'),HF_HUB_CACHE:path.join(home,'models'),HF_HUB_DISABLE_TELEMETRY:'1',HF_HUB_DISABLE_XET:'1',HF_HUB_DISABLE_SYMLINKS_WARNING:'1',PIP_DISABLE_PIP_VERSION_CHECK:'1'};
  const venv=path.join(home,'venv'),exe=path.join(venv,'Scripts/python.exe');
  const ready=path.join(home,'ready-1.2.1.json');
  if(!existsSync(ready)||!existsSync(exe)) {
    console.log(`Preparing local word aligner once: ${home}`);
    if(!existsSync(exe))await run(python,['-m','venv',venv],env,home);
    await run(exe,['-m','pip','install','--no-cache-dir','-r',path.join(root,'runtime/alignment-requirements.txt')],env,home);
    await run(exe,['-c','import faster_whisper; assert faster_whisper.__version__ == "1.2.1"'],env,home);
    await fs.writeFile(ready,JSON.stringify({engine:'faster-whisper==1.2.1'}));
  }
  console.log('Aligning supplied text to audio locally (cached model reused when available).');
  await run(exe,[path.join(root,'runtime/scripts/align_words.py'),'--source',path.join(job,'source.json'),'--out',dest,'--models',path.join(home,'models')],env,job);
  validateWordTimings(source,JSON.parse(await fs.readFile(dest,'utf8')));
  return dest;
}
