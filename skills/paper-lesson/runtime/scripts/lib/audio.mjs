import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {hash} from './text.mjs';
import {groupWordCues} from './word-srt.mjs';

const compositor=()=>path.dirname(createRequire(import.meta.url).resolve('@remotion/compositor-win32-x64-msvc'));
function mediaCommand(name,args) {
  const result=spawnSync(path.join(compositor(),name+'.exe'),args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||`${name} failed`);
  return result.stdout;
}
export function parseSrt(raw) {
  const stamp=value=>{const m=value.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);if(!m||+m[2]>59||+m[3]>59)throw new Error(`Invalid SRT timestamp: ${value}`);return +m[1]*3600 + +m[2]*60 + +m[3]+ +m[4]/1000;};
  let previous=0;
  const cues=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n\s*\n/).map((block,i)=>{
    const lines=block.split('\n');if(/^\d+$/.test(lines[0].trim()))lines.shift();
    const match=lines.shift()?.trim().match(/^(\S+)\s+-->\s+(\S+)$/);
    if(!match)throw new Error(`SRT cue ${i+1}: missing timestamp line`);
    const startSeconds=stamp(match[1]),endSeconds=stamp(match[2]);
    // These are TTS stage directions, not spoken words. Preserve the input SRT separately.
    const text=lines.join(' ').replace(/<\/?(?:b|i|u)>/gi,'').replace(/\((?:breath|laughs?|sighs?|coughs?)\)/gi,'').replace(/\s+/g,' ').trim();
    if(startSeconds<previous||endSeconds<=startSeconds||!lines.join(' ').trim())throw new Error(`SRT cue ${i+1}: empty text, overlapping or invalid interval`);
    previous=endSeconds;return text?{cue:i+1,startSeconds,endSeconds,text}:null;
  }).filter(Boolean);
  if(!cues.length)throw new Error('SRT contains no spoken text');
  return cues;
}
export function timedText(cues,duration) {
  if(!Number.isFinite(duration)||duration<=0||cues.at(-1).endSeconds>duration+0.05)throw new Error('Subtitle timestamps exceed audio duration');
  let offset=0;
  const segments=cues.map((cue,i)=>{
    const text=cue.text+(i<cues.length-1?'\n':'');
    const segment={...cue,id:`s${String(i+1).padStart(3,'0')}`,start:offset,end:offset+text.length,text};offset+=text.length;return segment;
  });
  return {text:segments.map(s=>s.text).join(''),segments};
}
export async function prepareAudio(audioFile,subtitleFile,out,{subtitleLevel='auto'}={}) {
  if(!['auto','cue','word'].includes(subtitleLevel))throw new Error('subtitle-level must be auto, cue or word');
  const wordLevel=subtitleLevel==='word'||(subtitleLevel==='auto'&&/\.word\.srt$/i.test(subtitleFile));
  const metadata=JSON.parse(mediaCommand('ffprobe',['-v','error','-show_streams','-show_format','-of','json',audioFile]));
  const stream=metadata.streams.find(s=>s.codec_type==='audio'),duration=Number(metadata.format.duration);
  if(!stream||!Number.isFinite(duration)||duration<=0)throw new Error('Input has no usable audio stream');
  const raw=await fs.readFile(subtitleFile,'utf8'),cues=parseSrt(raw);
  // Include trailing stage directions in the duration check even though they are not displayed.
  const ends=[...raw.matchAll(/-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})/g)].map(m=>+m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000);
  if(Math.max(...ends)>duration+.05)throw new Error('Subtitle timestamps exceed audio duration');
  const groups=wordLevel?groupWordCues(cues):null;
  const timed=timedText(groups?groups.map(({words,...cue})=>cue):cues,duration);
  const audioPath=path.join(out,'narration'+path.extname(audioFile).toLowerCase());
  await fs.copyFile(audioFile,audioPath);
  await fs.copyFile(subtitleFile,path.join(out,'original-subtitles.srt'));
  return {...timed,...(groups?{wordGroups:groups}:{}),timingMode:'subtitles',audio:{path:audioPath,sha256:hash(await fs.readFile(audioPath)),duration,sampleRate:Number(stream.sample_rate),channels:stream.channels},
    subtitles:{path:path.join(out,'original-subtitles.srt'),sha256:hash(raw),precision:wordLevel?'word':'cue',withinCue:wordLevel?'provided word timestamps':'text-weight estimate',removedStageDirections:true}};
}
export async function checkAudio(audio) {
  if(hash(await fs.readFile(audio.path))!==audio.sha256)throw new Error('Saved narration changed. Prepare a new job with its matching subtitles.');
}
export async function muxAudio({video,audio,offset=0,duration}) {
  await checkAudio(audio);
  const temp=video.replace(/\.mp4$/i,'.audio-mux.mp4');
  mediaCommand('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,...(offset?['-ss',String(offset)]:[]),'-i',audio.path,
    '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(duration),'-map_metadata','-1','-movflags','+faststart',temp]);
  await fs.rename(temp,video);
}
