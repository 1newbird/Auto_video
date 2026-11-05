// Only source segmentation and deterministic compilation; no Skill job/review API.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,segmentSource} from './runtime/scripts/lib/text.mjs';
import {compileLesson,makeSrt} from './runtime/scripts/lib/compile.mjs';
import {validateLesson} from './runtime/scripts/lib/validate-lesson.mjs';
import {audioSource} from './runtime/scripts/lib/audio-timeline.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'runtime');
const [command,job,input]=process.argv.slice(2);
try {
  if(command==='prepare') {
    const raw=await fs.readFile(input,'utf8');
    const text=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
    if(!text)throw new Error('输入文本为空');
    const timeline=await fs.readFile(path.join(job,'audio-timeline.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const source=timeline?audioSource(text,timeline):{schemaVersion:1,text,sha256:hash(text),segments:segmentSource(text)};
    await fs.mkdir(job,{recursive:true});
    await fs.writeFile(path.join(job,'source.json'),JSON.stringify(source,null,2));
    await fs.writeFile(path.join(job,'script.txt'),text);
    console.log(`已读取 ${source.segments.length} 段文本`);
  } else if(command==='compile') {
    const source=JSON.parse(await fs.readFile(path.join(job,'source.json'),'utf8'));
    const plan=JSON.parse(await fs.readFile(path.join(job,'plan.json'),'utf8'));
    const font=spawnSync(process.env.PAPER_LESSON_PYTHON||'python',[path.join(root,'scripts/font_metrics.py'),path.join(root,'public/fonts/ChillZhuo.ttf')],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
    if(font.status!==0)throw new Error(font.stderr||'无法读取字体');
    const videoPath=path.join(job,'video-settings.json');
    const video=await fs.readFile(videoPath,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
    const lesson=compileLesson(source,plan,JSON.parse(font.stdout),video);
    validateLesson(lesson);
    for(const change of lesson.layoutAdjustments??[])console.log(`[排版] ${change.pageId} 超出可读容量，按原内容边界拆为 ${change.pages.map(p=>p.id).join('、')}；不调用模型`);
    await fs.writeFile(path.join(job,'lesson.json'),JSON.stringify(lesson,null,2));
    await fs.writeFile(path.join(job,'captions.srt'),makeSrt(lesson));
    console.log(`排版完成：${lesson.pages.length} 页，${lesson.duration.toFixed(2)} 秒，${lesson.width}×${lesson.height} / ${lesson.fps}fps`);
  } else throw new Error('Unknown bridge command');
} catch(error) {console.error(error.message);process.exitCode=1;}
