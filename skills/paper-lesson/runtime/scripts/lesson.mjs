import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,normalizeScript,segmentSource} from './lib/text.mjs';
import {compileLesson,makeSrt} from './lib/compile.mjs';
import {validateLesson} from './lib/validate-lesson.mjs';
import {normalizePlan} from './lib/normalize-plan.mjs';
import {resolveVideoOptions} from '../../scripts/settings.mjs';
import {prepareAudio} from './lib/audio.mjs';
import {wordTimingsFromGroups} from './lib/word-srt.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),command=args.shift();
const opt=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing ${name}`);return args[i+1];};
const required=name=>{const value=opt(name);if(!value)throw new Error(`Required ${name}`);return value;};
try {
  if(command==='prepare') {
    const input=path.resolve(required('--script')),out=path.resolve(required('--out'));
    const raw=await fs.readFile(input,'utf8');let selected=raw;
    const start=opt('--start'),end=opt('--end-before');
    if(start){const i=selected.indexOf(start);if(i<0)throw new Error('Start marker not found');selected=selected.slice(i);}
    if(end){const i=selected.indexOf(end);if(i<0)throw new Error('End marker not found');selected=selected.slice(0,i);}
    let text=normalizeScript(selected);if(!text)throw new Error('Script is empty');
    const audio=opt('--audio'),subtitles=opt('--subtitles');
    if(Boolean(audio)!==Boolean(subtitles))throw new Error('Provide --audio and --subtitles together');
    if(audio&&(start||end))throw new Error('Audio mode uses the complete matching audio and SRT; do not apply text-only selection');
    await fs.mkdir(out,{recursive:true});
    const timed=audio?await prepareAudio(path.resolve(audio),path.resolve(subtitles),out,{subtitleLevel:opt('--subtitle-level','auto')}):null;
    const wordGroups=timed?.wordGroups;if(timed)delete timed.wordGroups;
    const referenceText=text;if(timed)text=timed.text;
    const source={schemaVersion:1,sourcePath:input,originalSha256:hash(raw),selection:{start:start??null,endBefore:end??null},
      normalization:'Remove Markdown headings/list markers/emphasis/code delimiters and zero-width characters; normalize whitespace. No wording rewrite.',sha256:hash(text),text,segments:segmentSource(text)};
    if(timed)Object.assign(source,timed,{normalization:'Use SRT spoken text and cue times; remove known TTS stage directions. Markdown is reference material.',referenceScript:{text:referenceText,sha256:hash(referenceText)},referenceDiffers:referenceText.replace(/\s/g,'')!==text.replace(/\s/g,'')});
    await fs.writeFile(path.join(out,'source.json'),JSON.stringify(source,null,2));
    if(wordGroups) {
      await fs.writeFile(path.join(out,'word-timings.json'),JSON.stringify(wordTimingsFromGroups(source,wordGroups),null,2));
      console.log(`Imported ${wordGroups.reduce((n,g)=>n+g.words.length,0)} word pieces into ${wordGroups.length} spoken segments; no acoustic model needed.`);
    }
    await fs.writeFile(path.join(out,'script.txt'),text);
    console.log(JSON.stringify({source:path.join(out,'source.json'),sha256:source.sha256,timingMode:source.timingMode??'estimated',audioDuration:source.audio?.duration,referenceDiffers:source.referenceDiffers,segments:source.segments},null,2));
  } else if(command==='compile') {
    const out=path.resolve(required('--out'));await fs.mkdir(out,{recursive:true});
    let report={passed:false,repairs:[]};
    try {
    const source=JSON.parse(await fs.readFile(path.resolve(required('--source')),'utf8'));
    const plan=JSON.parse(await fs.readFile(path.resolve(required('--plan')),'utf8'));
    report={...report,sourceHash:source.sha256,planHash:hash(JSON.stringify(plan))};
    const result=spawnSync(process.env.PAPER_LESSON_PYTHON||'python',[path.join(root,'scripts/font_metrics.py'),path.join(root,'public/fonts/ChillZhuo.ttf')],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
    if(result.status!==0)throw new Error(result.stderr||'Font metrics failed');
    const metrics=JSON.parse(result.stdout);
    const normalized=normalizePlan(plan,source,metrics);report.repairs=normalized.repairs;
    await fs.writeFile(path.join(out,'normalized-plan.json'),JSON.stringify(normalized.plan,null,2));
    const video=await resolveVideoOptions({quality:opt('--quality'),fps:opt('--fps')===undefined?undefined:Number(opt('--fps'))});
    const wordFile=opt('--word-timings');
    if(source.audio&&!wordFile)throw new Error('Audio compilation requires word timings. Use the Skill check/build entrypoint or align first.');
    const wordTimings=wordFile?JSON.parse(await fs.readFile(path.resolve(wordFile),'utf8')):undefined;
    const lesson=compileLesson(source,normalized.plan,metrics,{...video,wordTimings});
    validateLesson(lesson);
    await fs.writeFile(path.join(out,'lesson.json'),JSON.stringify(lesson,null,2));
    await fs.writeFile(path.join(out,'captions.srt'),makeSrt(lesson));
    report={...report,passed:true,video,pages:lesson.pages.length,captions:lesson.captions.length,gestures:lesson.pages.reduce((n,p)=>n+p.gestures.length,0),duration:lesson.duration,timingMode:lesson.timingMode,...(lesson.audio?{audioDuration:lesson.audio.duration,subtitlePrecision:lesson.subtitlePrecision,gestureTiming:lesson.gestureTiming,wordAlignment:lesson.wordAlignment,timingAdjustments:lesson.timingAdjustments,anchors:lesson.pages.flatMap(p=>p.gestures.map(g=>({id:g.id,quote:g.quote??null,segment:g.segment,keywordSeconds:g.anchorSeconds,penArrivalSeconds:g.startFrame/lesson.fps,inkStartSeconds:g.activeStart/lesson.fps,errorFrames:g.wordSyncErrorFrames})))}:{})};
    await fs.writeFile(path.join(out,'compile-report.json'),JSON.stringify(report,null,2));
    console.log(`Compiled ${lesson.pages.length} pages, ${lesson.captions.length} captions, ${lesson.duration.toFixed(2)} seconds: ${out}`);
    console.log(`Output: ${video.quality}, ${video.width}x${video.height}, ${video.fps} fps`);
    if(report.repairs.length)console.log(`Applied ${report.repairs.length} deterministic fixes; see compile-report.json. Original plan.json preserved.`);
    } catch(error) {
      await fs.writeFile(path.join(out,'compile-report.json'),JSON.stringify({...report,repairs:error.repairs??report.repairs,error:error.message,issues:error.issues??[{message:error.message}]},null,2));
      throw error;
    }
  } else {
    throw new Error('Usage: lesson.mjs prepare --script file --out job [--audio file --subtitles file.srt | --start text --end-before text] | compile --source source.json --plan plan.json --out job');
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
