import {validateWordTimings} from './word-timing.mjs';

// Join exported character/word pieces without inventing spaces or changing times.
// A sentence is a planning unit, not a page or a one-word display caption.
export function groupWordCues(cues) {
  const groups=[];let group=null;
  const finish=()=>{if(group){groups.push(group);group=null;}};
  for(const cue of cues) {
    const closing=/^[”’」』）】》]+$/.test(cue.text);
    if(group&&!closing&&(/[。！？!?；;][”’」』）】》]*$/.test(group.text)||cue.startSeconds-group.endSeconds>=.8))finish();
    group??={cue:groups.length+1,startSeconds:cue.startSeconds,endSeconds:cue.endSeconds,text:'',words:[]};
    const start=group.text.length;
    group.text+=cue.text;group.endSeconds=cue.endSeconds;
    group.words.push({text:cue.text,start,end:group.text.length,startSeconds:cue.startSeconds,endSeconds:cue.endSeconds});
  }
  finish();return groups;
}

export function wordTimingsFromGroups(source,groups) {
  if(groups.length!==source.segments.length)throw new Error('Word SRT grouping changed; prepare a new job with the matching inputs');
  const segments={};
  for(let i=0;i<groups.length;i++) {
    const group=groups[i],segment=source.segments[i];
    if(segment.text.trimEnd()!==group.text||segment.startSeconds!==group.startSeconds||segment.endSeconds!==group.endSeconds)
      throw new Error(`Word SRT differs from saved source: ${segment.id}`);
    segments[segment.id]=group.words;
  }
  return validateWordTimings(source,{schemaVersion:1,sourceHash:source.sha256,audioHash:source.audio.sha256,
    cueTimes:source.segments.map(s=>[s.id,s.startSeconds,s.endSeconds]),method:'provided-word-srt',segments});
}
