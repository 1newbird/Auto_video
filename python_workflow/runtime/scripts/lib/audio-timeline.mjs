import {hash} from './text.mjs';

export function audioSource(originalText, timeline) {
  if (!Number.isFinite(timeline.duration) || timeline.duration <= 0 || !timeline.cues?.length)
    throw new Error('Invalid audio timeline');
  let text='',lastEnd=0;
  const segments=timeline.cues.map((cue,index)=>{
    if(cue.id!==`s${String(index+1).padStart(3,'0')}` || !cue.text?.trim() ||
       !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) ||
       cue.startSeconds<lastEnd || cue.endSeconds<=cue.startSeconds || cue.endSeconds>timeline.duration+.05)
      throw new Error(`Invalid audio cue ${cue.id}`);
    const start=text.length;text+=cue.text;lastEnd=cue.endSeconds;
    return {...cue,start,end:text.length};
  });
  return {schemaVersion:1,text,sha256:hash(text),segments,originalText,
    audio:{duration:timeline.duration,granularity:timeline.alignment?'character/word':'sentence',alignment:timeline.alignment,captionSplitTiming:'proportional-within-cue'}};
}

export const normalizedQuote=text=>[...String(text)].filter(c=>/[A-Za-z0-9\u3400-\u9fff]/u.test(c)).join('').toLowerCase();

export function targetTexts(spec) {
  const result={};
  function visit(value) {
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(value.id)result[value.id]=value.text??value.title??(value.runs?.map(r=>r.text).join(''))??'';
    Object.values(value).forEach(visit);
  }
  visit(spec.elements??spec.blocks??spec.steps);
  return result;
}

export function resolveWordAnchor(cue,gesture,targetText='') {
  const quote=gesture.quote??targetText,needle=normalizedQuote(quote),hay=normalizedQuote(cue.text);
  if(needle.length<2)throw new Error('需要明确的台词 quote（至少两个字母/汉字）');
  const positions=[];
  for(let pos=hay.indexOf(needle);pos>=0;pos=hay.indexOf(needle,pos+1))positions.push(pos);
  if(!positions.length)throw new Error(`台词中没有“${quote}”，请填写原话 quote`);
  if(positions.length>1&&gesture.occurrence===undefined)throw new Error(`台词“${quote}”重复，请指定 occurrence`);
  const occurrence=gesture.occurrence??1;
  if(!Number.isInteger(occurrence)||occurrence<1||occurrence>positions.length)throw new Error('occurrence 超出范围');
  const from=positions[occurrence-1],to=from+needle.length;
  const words=(cue.words??[]).filter(w=>w.to>from&&w.from<to);
  if(!words.length||words[0].from!==from||words.at(-1).to!==to)throw new Error('缺少该台词的完整字/词时间，未使用比例估算');
  if(words.some(w=>!Number.isFinite(w.startSeconds)||!Number.isFinite(w.endSeconds)||w.endSeconds<=w.startSeconds))throw new Error('关键词时间无效');
  return {quote,occurrence,startSeconds:words[0].startSeconds,endSeconds:words.at(-1).endSeconds};
}

export function scheduleWordGesture(anchor,timing,page,targets,previousEnd,fps) {
  const anchorFrame=Math.round(anchor.startSeconds*fps);
  const start=Math.max(page.startFrame,anchorFrame-11,previousEnd+6,...targets.filter(Boolean).map(t=>t.visibleFrom));
  const activeStart=Math.max(anchorFrame,start+1);
  // Never move emphasis far away from its word just to fit another action.
  if(activeStart-anchorFrame>Math.round(.1*fps))return null;
  const drawing=Math.round(Math.min(1.5,Math.max(.35,anchor.endSeconds-anchor.startSeconds))*fps);
  const activeEnd=Math.min(activeStart+drawing,timing.endFrame,page.endFrame-1);
  const end=Math.min(activeEnd+13,page.endFrame);
  if(activeEnd-activeStart<6||end<=activeEnd)return null;
  return {start,end,activeStart,activeEnd};
}

// Fixed scheduling: model seconds/offsets never control the audio timeline.
// Keep pen actions within their cue and after target reveal; skip if no room.
export function scheduleAudioGesture(timing,page,targets,previousEnd,fps) {
  const start=Math.max(timing.startFrame,...targets.filter(Boolean).map(t=>t.visibleFrom),previousEnd+6);
  const end=Math.min(start+Math.round(1.8*fps),timing.endFrame,page.endFrame);
  if(end-start<fps)return null;
  return {start,end};
}
