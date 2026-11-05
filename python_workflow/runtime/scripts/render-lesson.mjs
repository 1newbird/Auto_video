import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill,renderMedia} from '@remotion/renderer';
import {hash} from './lib/text.mjs';
import {validateLesson} from './lib/validate-lesson.mjs';
import {renderStates} from './lib/state-renderer.mjs';
import {assertWithinOutput,storageEnvironment} from './lib/storage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const opt=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing ${name}`);return args[i+1];};
const input=path.resolve(opt('--lesson','out/lesson-v1/lesson.json'));
const lesson=JSON.parse(await fs.readFile(input,'utf8'));validateLesson(lesson);
const outputArgument=opt('--out-dir');
if(!outputArgument)throw new Error('Pass --out-dir from the Python workflow configuration.');
const out=path.resolve(outputArgument);
await assertWithinOutput(process.env.PAPER_LESSON_OUTPUT_ROOT??out,out);
Object.assign(process.env,await storageEnvironment(out));
process.chdir(out);
const preview=args.includes('--preview'),videoOnly=args.includes('--video-only');
const strategy=opt('--strategy','state-cache');
if(!['state-cache','legacy'].includes(strategy))throw new Error('Unknown render strategy');
if(preview&&videoOnly)throw new Error('Choose preview or video-only');
const clipStart=opt('--clip-start'),clipDuration=opt('--clip-duration');
const isClip=clipStart!==undefined||clipDuration!==undefined;
let frameRange;
if(isClip) {
  if(preview||videoOnly)throw new Error('Clip exports include their own verification stills; do not combine with preview/video-only');
  if(clipStart===undefined||clipDuration===undefined||!Number.isFinite(Number(clipStart))||!Number.isFinite(Number(clipDuration))||Number(clipStart)<0||Number(clipDuration)<=0)throw new Error('Clip requires nonnegative --clip-start and positive --clip-duration');
  const start=Math.round(Number(clipStart)*lesson.fps),end=start+Math.round(Number(clipDuration)*lesson.fps)-1;
  if(end<start||end>=lesson.durationFrames)throw new Error('Clip range exceeds lesson');
  frameRange=[start,end];
}
const concurrency=Number(opt('--concurrency','4'));
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('concurrency must be 1–8');
await fs.mkdir(path.join(out,'frames'),{recursive:true});
const started=performance.now();
const build=path.join(out,'bundle');
// No persistent bundler cache in the installed runtime (which may be on C:).
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),outDir:build,enableCaching:false});
const browserExecutable=path.join(root,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
await fs.access(browserExecutable).catch(()=>{throw new Error('Rendering browser is missing. Install dependencies explicitly; the render will not download into another directory.');});
const browser=await openBrowser('chrome',{logLevel:'warn',browserExecutable});
const samples=new Set([0,lesson.durationFrames-1]);
for(const p of lesson.pages) {
  samples.add(p.startFrame);if(p.startFrame)samples.add(p.startFrame-1);
  samples.add(p.endFrame-1);
  const cs=lesson.captions.filter(c=>c.pageId===p.id);samples.add(cs[0].startFrame);
  for(const g of p.gestures) {
    samples.add(Math.floor((g.activeStart+g.activeEnd)/2));
    if(g.ink)for(const f of [g.startFrame-1,g.activeStart,g.activeEnd,g.endFrame])samples.add(f);
  }
  const red=Object.values(p.targets).find(t=>t.red);
  if(red) {samples.add(red.visibleFrom-1);samples.add(red.visibleFrom);}
}
if(isClip){samples.add(frameRange[0]);samples.add(frameRange[1]);}
const frames=[...samples].filter(f=>f>=0&&f<lesson.durationFrames&&(!isClip||(f>=frameRange[0]&&f<=frameRange[1]))).sort((a,b)=>a-b);
let cacheStats;
try {
  // Rasterize the fixed paper once. Per-frame SVG contains only text, ink and pen.
  const blank={...lesson.pages[0].board,items:[]};
  const backgroundComposition=await selectComposition({serveUrl,id:'PaperBoard',inputProps:{board:blank},puppeteerInstance:browser,logLevel:'warn'});
  const background='lesson-paper.png';
  await renderStill({composition:backgroundComposition,serveUrl,inputProps:{board:blank},puppeteerInstance:browser,frame:0,imageFormat:'png',output:path.join(build,'public',background),logLevel:'warn'});
  const inputProps={lesson,background};
  const composition=await selectComposition({serveUrl,id:'PaperLesson',inputProps,puppeteerInstance:browser,logLevel:'warn'});
  const common={composition,serveUrl,inputProps,puppeteerInstance:browser,logLevel:'warn'};
  if(!videoOnly) {
    for(const frame of frames) {await renderStill({...common,frame,imageFormat:'png',output:path.join(out,'frames',`${String(frame).padStart(5,'0')}.png`)});console.log(`Preview frame ${frame}/${lesson.durationFrames-1}`);}
    if(!isClip) {
      for(const [i,p] of lesson.pages.entries()) await fs.copyFile(path.join(out,'frames',`${String(p.endFrame-1).padStart(5,'0')}.png`),path.join(out,`page-${i+1}.png`));
      // Only obsolete generated page previews in this exact output directory.
      for(const file of await fs.readdir(out))if(/^page-\d+\.png$/.test(file)&&Number(file.match(/\d+/)[0])>lesson.pages.length)await fs.unlink(path.join(out,file));
    }
    await renderStill({...common,frame:frames.at(-1),imageFormat:'png',output:path.join(out,'frames',isClip?'clip-repeat.png':'repeat.png')});
    await fs.copyFile(path.join(out,'frames',`${String(frames.at(-1)).padStart(5,'0')}.png`),path.join(out,isClip?'clip-poster.png':'poster.png'));
  }
  if(!preview) {
    if(strategy==='state-cache')cacheStats=await renderStates({lesson,common,out,root,frameRange,concurrency,streamEncoder:opt('--stream-encoder',path.join(root,'scripts/stream_encode.py'))});
    else {let last=-1;
    await renderMedia({...common,...(isClip?{frameRange}:{}),codec:'h264',outputLocation:path.join(out,isClip?'clip.mp4':'lesson.mp4'),imageFormat:'png',pixelFormat:'yuv420p',crf:18,x264Preset:'medium',concurrency,muted:true,
      onProgress:({progress})=>{const percent=Math.floor(progress*20)*5;if(percent!==last){last=percent;console.log(`Video ${percent}%`);}}});}
  }
  const manifest={schemaVersion:1,source:input,lessonHash:hash(JSON.stringify(lesson)),lesson,frames,videoRendered:!preview,renderSeconds:Math.round((performance.now()-started)/1000),backgroundCached:true,strategy,cacheStats,storage:{output:out,temp:process.env.TEMP,build,bundlerDiskCache:false,browserExecutable},...(isClip?{frameRange,videoFile:'clip.mp4'}:{})};
  await fs.writeFile(path.join(out,isClip?'clip-manifest.json':preview?'preview-manifest.json':'render-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(`Done: ${out} (${manifest.renderSeconds}s)`);
} finally {await browser.close({silent:true});}
