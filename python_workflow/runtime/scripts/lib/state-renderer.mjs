import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {renderFrames,selectComposition} from '@remotion/renderer';
import {hash} from './text.mjs';
import {renderTimeline} from './render-timeline.mjs';

async function run(executable,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>{stderr=(stderr+b).slice(-12000);});
    child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(new Error(stderr||`${executable} exited ${code}`)));
  });
}
const exists=async file=>{try{await fs.access(file);return true;}catch{return false;}};
export async function renderStates({lesson,common,out,root,frameRange,concurrency=4,streamEncoder}) {
  const started=performance.now(),timeline=renderTimeline(lesson,frameRange),dependencies=[];
  // Caption and motion PNGs must never leak between output sizes or frame rates.
  dependencies.push(['output-profile',{width:lesson.width,height:lesson.height,fps:lesson.fps}]);
  for(const dir of ['src','public']) {
    for(const file of (await fs.readdir(path.join(root,dir),{recursive:true})).sort()) {
      const full=path.join(root,dir,file);if((await fs.stat(full)).isFile())dependencies.push([dir+'/'+file,hash(await fs.readFile(full))]);
    }
  }
  for(const file of ['package-lock.json','requirements.txt','scripts/render-lesson.mjs','scripts/lib/state-renderer.mjs','scripts/lib/render-timeline.mjs','scripts/composite_states.py'])dependencies.push([file,hash(await fs.readFile(path.join(root,file)))]);
  // Captions use the installed Microsoft YaHei font; changing it invalidates assets.
  const systemFonts=path.join(process.env.WINDIR??'C:/Windows','Fonts');
  for(const font of ['msyh.ttc','msyhbd.ttc','arial.ttf'])if(await exists(path.join(systemFonts,font)))dependencies.push([font,hash(await fs.readFile(path.join(systemFonts,font)))]);
  const signature=hash(JSON.stringify(dependencies)),cache=path.join(out,'.cache','r',signature.slice(0,24));
  await fs.mkdir(cache,{recursive:true});
  const stats={strategy:'state-cache',signature,staticStates:timeline.board.filter(s=>!s.dynamic).length,dynamicFrames:0,boardCreated:0,boardReused:0,captionCreated:0,captionReused:0,dynamicCreated:0,dynamicReused:0};
  const boardProps={...common.inputProps,layer:'board'},captionProps={...common.inputProps,layer:'caption'};
  const boardComposition=await selectComposition({...common,id:'PaperLesson',inputProps:boardProps});
  const captionComposition=await selectComposition({...common,id:'PaperLesson',inputProps:captionProps});
  const boardJobs=new Map(),captionJobs=new Map(),motionDone=[];
  const scheduled=new Set();
  const schedule=(jobs,frame,file)=>{if(scheduled.has(file))return false;scheduled.add(file);jobs.set(frame,file);return true;};
  for(const state of timeline.board) {
    if(state.dynamic) {
      stats.dynamicFrames+=state.end-state.start;
      const dir=path.join(cache,'m-'+state.key.slice(0,24)),done=path.join(dir,'complete.json');
      const count=state.end-state.start;
      // Stored frame names are local indices, so an earlier timing edit can reuse them.
      const localFiles=Array.from({length:count},(_,i)=>path.join(dir,`${i}.png`));
      if(await exists(done)&&(await Promise.all(localFiles.map(exists))).every(Boolean)){stats.dynamicReused+=count;}
      else {
        await fs.mkdir(dir,{recursive:true});
        for(let i=0;i<count;i++)schedule(boardJobs,state.start+i,localFiles[i]);
        motionDone.push({done,count});stats.dynamicCreated+=count;
      }
      state.files=localFiles;
    } else {
      state.file=path.join(cache,'b-'+state.key.slice(0,24)+'.png');
      if(await exists(state.file)||scheduled.has(state.file))stats.boardReused++;
      else {schedule(boardJobs,state.start,state.file);stats.boardCreated++;}
    }
  }
  for(const caption of timeline.captions) {
    caption.file=caption.lines.length?path.join(cache,'c-'+caption.key.slice(0,24)+'.png'):null;
    if(!caption.file)continue;
    if(await exists(caption.file)||scheduled.has(caption.file))stats.captionReused++;
    else {schedule(captionJobs,caption.start,caption.file);stats.captionCreated++;}
  }
  // Render sparse static frames and motion frames in a shared batch. Repeated
  // renderStill calls reopen pages/servers and can exhaust browser network buffers.
  async function batch(jobs,composition,inputProps,label) {
    if(!jobs.size)return;
    console.log(`Rasterizing ${jobs.size} ${label} frames`);
    await renderFrames({...common,composition,inputProps,frames:[...jobs.keys()].sort((a,b)=>a-b),imageFormat:'png',outputDir:null,concurrency,muted:true,
      onStart:()=>{},onFrameUpdate:()=>{},onFrameBuffer:async(buffer,frame)=>{
        const file=jobs.get(frame);await fs.writeFile(file+'.tmp',buffer);await fs.rename(file+'.tmp',file);
      }});
  }
  await batch(boardJobs,boardComposition,boardProps,'board/motion');
  for(const {done,count} of motionDone)await fs.writeFile(done,JSON.stringify({count}));
  await batch(captionJobs,captionComposition,captionProps,'caption');
  stats.rasterSeconds=(performance.now()-started)/1000;
  console.log(`State assets: ${stats.boardCreated} new boards, ${stats.captionCreated} new captions, ${stats.dynamicCreated} new motion frames; ${stats.boardReused+stats.captionReused+stats.dynamicReused} reused`);
  const states=[];
  for(const board of timeline.board)for(const caption of timeline.captions) {
    const start=Math.max(board.start,caption.start),end=Math.min(board.end,caption.end);if(start>=end)continue;
    if(board.dynamic)for(let f=start;f<end;f++)states.push({board:board.files[f-board.start],caption:caption.file,key:hash(board.key+':'+(f-board.start)+':'+caption.key),frames:1});
    else states.push({board:board.file,caption:caption.file,key:hash(board.key+':'+caption.key),frames:end-start});
  }
  const concat=path.join(cache,'timeline.ffconcat'),spec=path.join(cache,'composite.json');
  const ffmpeg=path.join(path.dirname(createRequire(import.meta.url).resolve('@remotion/compositor-win32-x64-msvc')),'ffmpeg.exe');
  const dest=path.join(out,frameRange?'clip.mp4':'lesson.mp4'),temp=dest+'.tmp.mp4';
  if(streamEncoder) {
    const encodeStart=performance.now();
    await fs.writeFile(spec,JSON.stringify({fps:lesson.fps,states,frames:timeline.end-timeline.start,ffmpeg,output:temp}));
    console.log(`Streaming ${timeline.end-timeline.start} frames from ${states.length} states (no composite PNG files)`);
    Object.assign(stats,JSON.parse(await run(process.env.PAPER_LESSON_PYTHON||'python',[path.resolve(streamEncoder),spec])));
    await fs.rename(temp,dest);stats.encodeSeconds=(performance.now()-encodeStart)/1000;
    return stats;
  }
  await fs.writeFile(spec,JSON.stringify({cache:path.join(cache,'composite'),fps:lesson.fps,states,concat}));
  const compositeStart=performance.now();
  Object.assign(stats,JSON.parse(await run(process.env.PAPER_LESSON_PYTHON||'python',[path.join(root,'scripts/composite_states.py'),spec])));
  stats.compositeSeconds=(performance.now()-compositeStart)/1000;
  const encodeStart=performance.now();
  console.log(`Encoding ${timeline.end-timeline.start} frames from ${states.length} image states`);
  await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-f','concat','-safe','0','-i',concat,'-an','-c:v','libx264','-crf','18','-preset','medium','-pix_fmt','yuv420p','-r',String(lesson.fps),'-fps_mode','cfr','-frames:v',String(timeline.end-timeline.start),'-movflags','+faststart',temp]);
  await fs.rename(temp,dest);stats.encodeSeconds=(performance.now()-encodeStart)/1000;
  return stats;
}
