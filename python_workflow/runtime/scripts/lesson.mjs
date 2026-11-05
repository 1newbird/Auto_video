import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,normalizeScript,segmentSource} from './lib/text.mjs';
import {compileLesson,makeSrt} from './lib/compile.mjs';
import {validateLesson} from './lib/validate-lesson.mjs';

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
    const text=normalizeScript(selected);if(!text)throw new Error('Script is empty');
    const source={schemaVersion:1,sourcePath:input,originalSha256:hash(raw),selection:{start:start??null,endBefore:end??null},
      normalization:'Remove Markdown headings/list markers/emphasis/code delimiters and zero-width characters; normalize whitespace. No wording rewrite.',sha256:hash(text),text,segments:segmentSource(text)};
    await fs.mkdir(out,{recursive:true});
    await fs.writeFile(path.join(out,'source.json'),JSON.stringify(source,null,2));
    await fs.writeFile(path.join(out,'script.txt'),text);
    console.log(JSON.stringify({source:path.join(out,'source.json'),sha256:source.sha256,segments:source.segments},null,2));
  } else if(command==='compile') {
    const source=JSON.parse(await fs.readFile(path.resolve(required('--source')),'utf8'));
    const plan=JSON.parse(await fs.readFile(path.resolve(required('--plan')),'utf8'));
    const out=path.resolve(required('--out'));await fs.mkdir(out,{recursive:true});
    const result=spawnSync(process.env.PAPER_LESSON_PYTHON||'python',[path.join(root,'scripts/font_metrics.py'),path.join(root,'public/fonts/ChillZhuo.ttf')],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
    if(result.status!==0)throw new Error(result.stderr||'Font metrics failed');
    const lesson=compileLesson(source,plan,JSON.parse(result.stdout));
    validateLesson(lesson);
    await fs.writeFile(path.join(out,'lesson.json'),JSON.stringify(lesson,null,2));
    await fs.writeFile(path.join(out,'captions.srt'),makeSrt(lesson));
    await fs.writeFile(path.join(out,'compile-report.json'),JSON.stringify({passed:true,sourceHash:source.sha256,planHash:hash(JSON.stringify(plan)),pages:lesson.pages.length,captions:lesson.captions.length,gestures:lesson.pages.reduce((n,p)=>n+p.gestures.length,0),duration:lesson.duration,timingMode:lesson.timingMode},null,2));
    console.log(`Compiled ${lesson.pages.length} pages, ${lesson.captions.length} captions, ${lesson.duration.toFixed(2)} seconds: ${out}`);
  } else {
    throw new Error('Usage: lesson.mjs prepare --script file --out job [--start text --end-before text] | compile --source source.json --plan plan.json --out job');
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
