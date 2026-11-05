// Deterministic timing only. Never extend or retime the user's recording.
export function scheduleAudioGestures(page,fps) {
  const changes=[],list=page.gestures;
  const minimum=Math.max(5,Math.round(.2*fps)),gap=Math.max(1,Math.round(.08*fps));
  let previous=page.startFrame-gap;
  for(let i=0;i<list.length;i++) {
    const g=list[i],originalStart=g.startFrame,originalEnd=g.endFrame;
    const latest=page.endFrame-(list.length-i)*minimum-(list.length-i-1)*gap;
    const visible=Math.max(page.targets[g.target].visibleFrom,g.to?page.targets[g.to].visibleFrom:0);
    const start=Math.max(previous+gap,visible,Math.min(originalStart,latest));
    if(start>latest)throw new Error(`Too many pen actions after target appears: ${g.id}; combine marks or use red text`);
    const untilNext=i+1<list.length?Math.max(minimum,list[i+1].startFrame-start-gap):Infinity;
    const duration=Math.min(originalEnd-originalStart,untilNext,latest-start+minimum);
    const phase=Math.max(1,Math.min(Math.round(.25*fps),Math.floor(duration/4)));
    Object.assign(g,{startFrame:start,endFrame:start+duration,activeStart:start+phase,activeEnd:start+duration-phase,fadeFrames:Math.min(phase,Math.max(1,Math.round(.1*fps)))});
    previous=g.endFrame;
    if(start!==originalStart||g.endFrame!==originalEnd)changes.push({gesture:g.id,from:[originalStart,originalEnd],to:[start,g.endFrame]});
  }
  return changes;
}
