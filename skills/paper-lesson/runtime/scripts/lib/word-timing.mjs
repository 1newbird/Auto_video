const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export function validateWordTimings(source,data) {
  assert(data?.schemaVersion===1&&data.sourceHash===source.sha256&&data.audioHash===source.audio?.sha256,'Word timings belong to different audio/text; run align again');
  assert(JSON.stringify(data.cueTimes)===JSON.stringify(source.segments.map(s=>[s.id,s.startSeconds,s.endSeconds])),'Subtitle times changed; run align again');
  for(const s of source.segments) {
    const words=data.segments?.[s.id];assert(Array.isArray(words)&&words.length,`Missing word timings: ${s.id}`);
    let position=0,last=s.startSeconds;
    for(const w of words) {
      assert(Number.isInteger(w.start)&&Number.isInteger(w.end)&&w.start===position&&w.end>w.start&&s.text.slice(w.start,w.end)===w.text,`Invalid word text/span: ${s.id}`);
      assert(Number.isFinite(w.startSeconds)&&Number.isFinite(w.endSeconds)&&w.startSeconds>=last-.001&&w.endSeconds>=w.startSeconds&&w.endSeconds<=s.endSeconds+.001,`Invalid word time: ${s.id}`);
      position=w.end;last=w.endSeconds;
    }
    assert(!s.text.slice(position).trim(),`Word timings omit text: ${s.id}`);
  }
  return data;
}
export function quoteTiming(segment,quote,data) {
  const start=quote?segment.text.indexOf(quote):0,end=quote?start+quote.length:segment.text.length;
  assert(start>=0&&(!quote||segment.text.indexOf(quote,start+1)<0),`Absent or ambiguous quote in ${segment.id}: ${quote}`);
  const pieces=data.segments[segment.id].filter(w=>w.end>start&&w.start<end&&/[\p{L}\p{N}]/u.test(w.text));
  assert(pieces.length,`Quote has no spoken words: ${quote??segment.id}`);
  const first=pieces[0],last=pieces.at(-1);
  // Zero-length tokens cannot honestly establish an exact keyword onset.
  assert(last.endSeconds>first.startSeconds,`No usable audio timing for quote ${quote??segment.id}; provide corrected word timings`);
  return {startSeconds:first.startSeconds,endSeconds:quote?last.endSeconds:Math.min(first.endSeconds,first.startSeconds+.8),precision:quote?'word':'first-spoken-word'};
}

export function wordCaptionBoundaries(segment,chunks,data,fps) {
  const first=Math.round(segment.startSeconds*fps),last=Math.round(segment.endSeconds*fps);
  const boundaries=[first];let offset=0;
  assert(last-first>=chunks.length,`Too little audio time for captions in ${segment.id}`);
  for(let i=1;i<chunks.length;i++) {
    offset+=chunks[i-1].length;
    const next=data.segments[segment.id].find(w=>w.end>offset&&/[\p{L}\p{N}]/u.test(w.text));
    assert(next,`Missing spoken text for caption in ${segment.id}`);
    boundaries.push(Math.max(boundaries.at(-1)+1,Math.min(last-(chunks.length-i),Math.round(next.startSeconds*fps))));
  }
  return [...boundaries,last];
}

export function scheduleWordGestures(page,fps) {
  const changes=[],list=page.gestures,entry=Math.max(1,Math.round(.2*fps)),exit=Math.max(1,Math.round(.15*fps));
  list.sort((a,b)=>a.wordAnchorFrame-b.wordAnchorFrame);
  let previous=page.startFrame;
  for(let i=0;i<list.length;i++) {
    const g=list[i],anchor=g.wordAnchorFrame;
    const visible=Math.max(page.targets[g.target].visibleFrom,g.to?page.targets[g.to].visibleFrom:0);
    assert(anchor>=visible,`Word ${g.quote??g.segment} occurs before target ${g.target} is visible`);
    // Reserve the next pen arrival; shorten strokes instead of moving keyword onsets.
    const limit=Math.min(page.endFrame-1,i+1<list.length?list[i+1].wordAnchorFrame-entry-1:Infinity);
    assert(anchor>=previous&&limit>=anchor+2,`Overlapping keyword marks at ${g.quote??g.segment}; combine these marks or use red text`);
    const start=Math.max(page.startFrame,previous,anchor-entry);
    const requested=Math.max(Math.round(.35*fps),Math.min(Math.round(1.2*fps),g.wordEndFrame-anchor));
    const end=Math.min(limit,anchor+requested+exit);
    const activeEnd=Math.max(anchor+1,Math.min(anchor+requested,end-1));
    Object.assign(g,{startFrame:start,activeStart:anchor,activeEnd,endFrame:end,fadeFrames:start===anchor?0:Math.max(1,Math.min(3,anchor-start)),wordSyncErrorFrames:0});
    previous=end+1;
    if(activeEnd<anchor+requested)changes.push({gesture:g.id,reason:'shortened stroke; keyword onset preserved',activeStart:anchor,activeEnd});
  }
  return changes;
}
