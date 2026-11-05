import {hash, units, captionChunks, captionLines, measure, wrap} from './text.mjs';
import {validateRow,layoutRuns,unionRects,combinePaths} from './rich-layout.mjs';
import {layoutElements} from './mixed-layout.mjs';
import {configureVideo} from './video-settings.mjs';
import {splitForCapacity} from './page-capacity.mjs';
import {scheduleAudioGesture,scheduleWordGesture,resolveWordAnchor,targetTexts} from './audio-timeline.mjs';
const fps=30,lead=12,preRoll=20,postRoll=24;
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export function validateSource(source) {
  assert(source.schemaVersion===1&&typeof source.text==='string','Unsupported source schema');
  assert(hash(source.text)===source.sha256,'Source text/hash mismatch');
  let cursor=0;const ids=new Set();
  for(const s of source.segments) {
    assert(!ids.has(s.id)&&s.start===cursor&&s.end>s.start&&source.text.slice(s.start,s.end)===s.text,`Invalid source segment ${s.id}`);
    ids.add(s.id);cursor=s.end;
  }
  assert(cursor===source.text.length,'Source segments must cover the original text');
}
function ellipse(b) {
  const cx=b.x+b.w/2,cy=b.y+b.h/2,rx=b.w/2+14,ry=b.h/2+12;
  return Array.from({length:81},(_,i)=>{const a=-Math.PI/3+i/80*Math.PI*2.06;return [cx+rx*Math.cos(a),cy+ry*Math.sin(a)];});
}
export function actionPoints(kind,b,to) {
  const y=b.y+b.h+10;
  if(kind==='point')return [[b.x+b.w+12,b.y+b.h*.65],[b.x+b.w+12,b.y+b.h*.65]];
  if(kind==='sweep'||kind==='underline')return [[b.x,y],[b.x+b.w*.35,y+2],[b.x+b.w*.72,y+1],[b.x+b.w,y-1]];
  if(kind==='orbit'||kind==='circle')return ellipse(b);
  if(kind==='link'&&to)return [[b.x+b.w+12,b.y+b.h*.65],[to.x+to.w+12,to.y+to.h*.65]];
  throw new Error(`Unsupported gesture ${kind}`);
}
export function compileLesson(source,plan,metrics,video={}) {
  const working=structuredClone(plan),adjustments=[];
  for(let attempt=0;attempt<source.segments.length;attempt++) {
    try {
      const lesson=compileLessonOnce(source,working,metrics,video);
      if(adjustments.length)lesson.layoutAdjustments=adjustments;
      return lesson;
    } catch(error) {
      if(!error.layoutOverflow)throw error;
      const index=working.pages.findIndex(p=>p.id===error.pageId);
      const parts=splitForCapacity(working.pages[index],new Set(working.pages.map(p=>p.id)));
      if(!parts)throw error;
      adjustments.push({pageId:error.pageId,reason:error.message,pages:parts.map(p=>({id:p.id,segments:p.segments}))});
      working.pages.splice(index,1,...parts);
    }
  }
  throw new Error('无法在保留内容和台词顺序的前提下完成分页');
}
function compileLessonOnce(source,plan,metrics,video={}) {
  validateSource(source);
  assert([1,2,3].includes(plan.schemaVersion)&&plan.sourceHash===source.sha256,'Plan schema or sourceHash mismatch');
  assert(Array.isArray(plan.pages)&&plan.pages.length>0,'Plan needs pages');
  if(plan.schemaVersion===3) {
    for(const key of Object.keys(plan))assert(['schemaVersion','sourceHash','unitsPerSecond','pages'].includes(key),`Unknown plan field: ${key}`);
    for(const page of plan.pages) {
      const layoutFields={mixed:['elements'],notes:['columns','blocks'],flow:['steps']}[page.layout];
      assert(layoutFields,`Unknown page layout: ${page.layout}`);
      for(const key of Object.keys(page))assert(['id','title','subtitle','layout','segments','gestures',...layoutFields].includes(key),`Unknown ${page.layout} page field: ${key}`);
    }
  }
  const ordered=plan.pages.flatMap(p=>p.segments);
  assert(JSON.stringify(ordered)===JSON.stringify(source.segments.map(s=>s.id)),'Pages must cover every source segment once, in original order');
  const audio=source.audio;
  const rate=audio?4.2:(plan.unitsPerSecond??4.2);
  assert(Number.isFinite(rate)&&rate>=2&&rate<=7,'unitsPerSecond must be between 2 and 7');
  const sources=new Map(source.segments.map(s=>[s.id,s]));
  const ids=new Set(),timings={},captions=[],pages=[],gestureSync=[];let cursor=0;
  for(const [pageIndex,page] of plan.pages.entries()) {
    assert(page.id&&!ids.has(page.id),'Duplicate or missing page id');ids.add(page.id);
    assert(page.segments.length>0,'Page needs at least one segment');
    const startFrame=audio?(pageIndex===0?0:Math.round(sources.get(page.segments[0]).startSeconds*fps)):cursor;
    if(!audio)cursor+=preRoll;
    for(const id of page.segments) {
      const s=sources.get(id),start=audio?Math.round(s.startSeconds*fps):cursor;
      const duration=audio?Math.round(s.endSeconds*fps)-start:Math.max(36,Math.round(units(s.text)/rate*fps));
      assert(duration>0,`Subtitle interval too short: ${id}`);
      timings[id]={startFrame:start,endFrame:start+duration,pageId:page.id};
      const chunks=captionChunks(s.text);let consumed=0,offset=s.start;
      for(let i=0;i<chunks.length;i++) {
        const chunk=chunks[i],from=start+Math.round(consumed/units(s.text)*duration);consumed+=units(chunk);
        const end=i===chunks.length-1?start+duration:start+Math.round(consumed/units(s.text)*duration);
        captions.push({id:`${id}-c${i+1}`,segment:id,sourceStart:offset,sourceEnd:offset+chunk.length,text:chunk,lines:captionLines(chunk),startFrame:from,endFrame:end,pageId:page.id});
        offset+=chunk.length;
      }
      if(!audio)cursor+=duration;
    }
    if(audio) {
      const next=plan.pages[pageIndex+1];
      cursor=next?Math.round(sources.get(next.segments[0]).startSeconds*fps):Math.ceil(audio.duration*fps);
    } else cursor+=postRoll;
    pages.push({id:page.id,title:page.title,startFrame,endFrame:cursor,items:[],targets:{},gestures:[],layout:page.layout});
  }
  const paper={color:'#fdfdfc',ink:'#292c30',red:'#ab3d34',rotation:-.55,top:110,finish:'white'};
  for(let pi=0;pi<pages.length;pi++) {
    const page=pages[pi],spec=plan.pages[pi],items=page.items,targets=page.targets;
    let seed=1000+pi*100,textScale=1;
    function reveal(segment) {
      const t=timings[segment];assert(t&&t.pageId===page.id,`Reveal references another/missing page segment: ${segment}`);
      return Math.max(page.startFrame,t.startFrame-lead);
    }
    function addText(id,text,x,y,size,width,segment,red=false,anchor='start') {
      assert(typeof text==='string'&&text.trim(),`Missing board text ${id}`);
      assert(!targets[id],`Duplicate target ${id}`);
      const lines=wrap(text,width,size,metrics),lineHeight=Math.round(size*1.36),at=reveal(segment);
      const used=Math.max(...lines.map(l=>measure(l,size,metrics)));
      assert(y+lines.length*lineHeight<=1390,`Page ${page.id} overflows at ${id}; shorten board text or split the page`);
      lines.forEach((line,i)=>items.push({id:`${id}-${i}`,kind:'text',at:at/fps,x,y:y+size+i*lineHeight,size,text:line,color:red?paper.red:paper.ink,anchor}));
      targets[id]={x:anchor==='middle'?x-used/2:x,y:y+size*.18,w:used,h:(lines.length-1)*lineHeight+size*.85,visibleFrom:at,red,segment};
      return lines.length*lineHeight;
    }
    function shape(id,path,at,width=2,color=paper.ink) {
      items.push({id,kind:'path',at:at/fps,path,seed:seed++,width,color,roughness:.55});
    }
    function addRow(row,x,y,width,inheritedSegment,depth=0,parentVisible=page.startFrame) {
      validateRow(row);assert(depth<=4,`Hierarchy too deep: ${row.id}`);
      const segment=row.segment??inheritedSegment,at=reveal(segment),size=Math.round(40*textScale);
      assert(at>=parentVisible,`Child row cannot appear before its parent: ${row.id}`);
      const parts=[];
      if(row.kind==='definition')parts.push({id:`${row.id}:label`,text:row.label,segment,at},{text:'：',segment,at});
      if(row.kind==='bullet')parts.push({text:'· ',segment,at});
      for(const run of row.runs) {
        const runSegment=run.segment??segment,runAt=reveal(runSegment);
        assert(runAt>=at,`Inline run cannot appear before its row: ${run.id??row.id}`);
        parts.push({...run,segment:runSegment,at:runAt});
      }
      const prefix=row.kind==='definition'?row.label+'：':row.kind==='bullet'?'· ':'';
      const layout=layoutRuns(parts,{x,y,width,size,metrics,hanging:measure(prefix,size,metrics)});
      assert(y+layout.height<=1390,`Page ${page.id} overflows at ${row.id}; shorten board text or split the page`);
      for(const [i,f] of layout.fragments.entries()) {
        const part=parts[f.partIndex];
        items.push({id:`${row.id}:fragment:${i}`,kind:'text',at:part.at/fps,x:f.x,y:f.y,size,text:f.text,color:part.red?paper.red:paper.ink});
      }
      function target(id,rects,subset) {
        assert(!targets[id],`Duplicate target ${id}`);
        const last=subset.reduce((a,b)=>b.at>a.at?b:a);
        targets[id]={...unionRects(rects),visibleFrom:last.at,red:subset.some(p=>p.red),segment:last.segment};
      }
      target(row.id,layout.rects,parts);
      parts.forEach((part,i)=>{if(part.id)target(part.id,layout.partRects[i],[part]);});
      let bottom=y+layout.height;
      for(const child of row.children??[]) {
        const childY=bottom+7*textScale,childSegment=child.segment??segment,childAt=reveal(childSegment);
        assert(width>180,`Hierarchy has insufficient width at ${child.id}`);
        shape(`${child.id}:branch`,`M ${x+6} ${y+layout.height-4} L ${x+6} ${childY+26} L ${x+25} ${childY+26}`,childAt,1.5,'#656565');
        bottom=childY+addRow(child,x+32,childY,width-32,segment,depth+1,at);
      }
      return bottom-y;
    }
    const first=spec.segments[0];
    assert(measure(spec.title,58,metrics)<=900,`Page title too long: ${spec.title}`);
    addText('page-title',spec.title,540,55,58,900,first,false,'middle');
    // The page title is present throughout the page, including the reading lead-in.
    items.forEach(item=>item.at=page.startFrame/fps);targets['page-title'].visibleFrom=page.startFrame;
    if(spec.subtitle)addText('page-subtitle',spec.subtitle,540,132,34,900,first,false,'middle');
    if(spec.layout==='mixed') {
      assert(plan.schemaVersion===3,'Mixed layout requires schemaVersion 3');
      // A diagram must also leave room for later notes/sections on the same page.
      const fixedItems=items.length,fixedTargets={...targets},fixedSeed=seed;
      // Try original typography first. Only when diagrams alone cannot fit,
      // compact all headings/rows together, never below 32px body text.
      let fitted=false,lastError;
      for(let textPercent=100;textPercent>=80&&!fitted;textPercent-=5) {
        textScale=textPercent/100;
        for(let percent=100;percent>=55;percent-=5) {
          items.length=fixedItems;
          for(const id of Object.keys(targets))delete targets[id];
          Object.assign(targets,fixedTargets);seed=fixedSeed;
          try {
            layoutElements(spec.elements,{x:95,y:spec.subtitle?220:185,width:890,segment:first,addText,addRow,shape,reveal,targets,metrics,ink:paper.ink,diagramScale:percent/100,textScale});
            page.layoutFit={textScale,diagramScale:percent/100};
            fitted=true;break;
          } catch(error) {
            if(!/overflows|Diagram .+ does not fit available space/.test(error.message))throw error;
            lastError=error;
          }
        }
      }
      if(!fitted) {lastError.layoutOverflow=true;lastError.pageId=page.id;throw lastError;}
    } else if(spec.layout==='notes') {
      assert(spec.blocks?.length>0,'Notes page needs blocks');const bottoms=[245,245];
      for(const [i,b] of spec.blocks.entries()) {
        const columns=plan.schemaVersion>=2?(spec.columns??1):2;
        assert(columns===1||columns===2,'columns must be 1 or 2');
        const column=b.column??(columns===1?0:bottoms[0]<=bottoms[1]?0:1);assert(column>=0&&column<columns&&Number.isInteger(column),'Invalid block column');
        const x=column===0?95:570,w=columns===1?890:415;let y=bottoms[column];
        y+=addText(b.id,b.title,x,y,45,w,b.segment)+26;
        if(plan.schemaVersion>=2) {
          assert(Array.isArray(b.rows)&&b.rows.length>0&&b.lines===undefined,`v2 block ${b.id} needs rows, not lines`);
          for(const row of b.rows)y+=addRow(row,x+12,y,w-12,b.segment,0,reveal(b.segment))+14;
        } else for(const line of b.lines??[])y+=addText(line.id,line.text,x+12,y,40,w-12,line.segment??b.segment,!!line.red)+18;
        bottoms[column]=y+(plan.schemaVersion>=2?48:72);
      }
    } else if(spec.layout==='flow') {
      assert(spec.steps?.length>=2&&spec.steps.length<=5,'Flow page needs 2–5 steps');
      const stepGap=Math.min(255,1120/spec.steps.length);let previous;
      for(const [i,s] of spec.steps.entries()) {
        const y=245+i*stepGap,at=reveal(s.segment),boxH=122;
        shape(`${s.id}-box`,`M 110 ${y} L 470 ${y-1} L 471 ${y+boxH} L 110 ${y+boxH+1} Z`,at);
        assert(addText(s.id,s.title,290,y+20,43,325,s.segment,false,'middle')<=59,`Flow title too long: ${s.id}; use one short line`);
        if(s.detail)assert(addText(`${s.id}-detail`,s.detail,290,y+73,33,325,s.segment,false,'middle')<=45,`Flow detail too long: ${s.id}; use one short line`);
        if(previous!==undefined)shape(`${s.id}-arrow`,`M 290 ${previous+boxH+10} L 290 ${y-16} M 280 ${y-30} L 290 ${y-16} L 300 ${y-30}`,at,2);
        let ny=y+5;
        for(const line of s.notes??[])ny+=plan.schemaVersion>=2?addRow(line,545,ny,435,s.segment,0,at)+10:addText(line.id,line.text,545,ny,line.red?40:37,435,line.segment??s.segment,!!line.red)+13;
        assert(ny<=y+stepGap-20,`Flow notes overlap next row: ${s.id}`);
        previous=y;
      }
    } else throw new Error(`Unknown page layout: ${spec.layout}`);
    let gestureSpecs=[...(spec.gestures??[])];
    const wordAnchors=new Map();
    if(audio?.alignment) {
      const texts=targetTexts(spec);
      gestureSpecs=gestureSpecs.filter(g=>{
        assert(timings[g.segment]?.pageId===page.id&&targets[g.target],`Invalid gesture anchor/target ${g.id}`);
        try {wordAnchors.set(g,resolveWordAnchor(sources.get(g.segment),g,texts[g.target]));return true;}
        catch(error) {
          gestureSync.push({pageId:page.id,id:g.id,target:g.target,segment:g.segment,status:'omitted',reason:error.message});
          console.log(`[词同步] ${page.id}/${g.id} 未画：${error.message}`);return false;
        }
      });
      gestureSpecs.sort((a,b)=>wordAnchors.get(a).startSeconds-wordAnchors.get(b).startSeconds);
    } else if(audio)gestureSpecs.sort((a,b)=>(timings[a.segment]?.startFrame??0)-(timings[b.segment]?.startFrame??0));
    for(const g of gestureSpecs) {
      assert(g.id&&!page.gestures.some(v=>v.id===g.id),`Duplicate gesture ${g.id}`);
      const t=timings[g.segment],b=targets[g.target],to=g.to?targets[g.to]:undefined;
      assert(t?.pageId===page.id&&b,`Invalid gesture anchor/target ${g.id}`);
      assert(typeof g.ink==='boolean',`Gesture ${g.id} must explicitly choose ink true/false`);
      assert(!g.ink||['circle','underline'].includes(g.kind),'Only circle/underline can leave ink');
      if(plan.schemaVersion>=2) {
        assert(['guide','emphasize','relate'].includes(g.intent),`v2 gesture ${g.id} needs an intent`);
        assert(g.intent!=='guide'||(!g.ink&&['point','sweep','orbit'].includes(g.kind)),`Guide gesture must not leave ink: ${g.id}`);
        assert(g.intent!=='emphasize'||(g.ink&&['circle','underline'].includes(g.kind)),`Emphasis must leave a deliberate mark: ${g.id}`);
        assert(g.intent!=='relate'||(!g.ink&&g.kind==='link'&&to),`Relate needs link and to: ${g.id}`);
      }
      let fraction=0;
      if(g.quote&&!audio) {
        const text=sources.get(g.segment).text,pos=text.indexOf(g.quote);
        assert(pos>=0,`Gesture quote is absent from source: ${g.quote}`);
        assert(text.indexOf(g.quote,pos+1)<0,`Gesture quote is ambiguous: ${g.quote}`);
        fraction=units(text.slice(0,pos))/units(text);
      }
      const boxes=b.rects??[b];
      const seconds=audio?1.8:(g.duration??(plan.schemaVersion>=2?Math.min(6,Math.max(2.6,1+boxes.length)):2.6));
      assert(Number.isFinite(seconds)&&seconds>=1.6&&seconds<=6,'Gesture duration must be 1.6–6 seconds');
      const offset=audio?0:(g.offset??0);assert(Number.isFinite(offset)&&offset>=0,'Gesture offset must be nonnegative');
      let start=Math.round(t.startFrame+fraction*(t.endFrame-t.startFrame)+offset*fps);
      let end=start+Math.round(seconds*fps);
      let activeStart,activeEnd;
      const anchor=wordAnchors.get(g);
      if(audio) {
        const scheduled=anchor?scheduleWordGesture(anchor,t,page,[b,to],page.gestures.at(-1)?.endFrame??-6,fps):scheduleAudioGesture(t,page,[b,to],page.gestures.at(-1)?.endFrame??-6,fps);
        if(!scheduled){
          console.log(`[音频] ${g.id} 可用时间不足或关键词动作冲突，保留板书，省略笔动作`);
          if(anchor)gestureSync.push({pageId:page.id,id:g.id,target:g.target,segment:g.segment,quote:anchor.quote,status:'omitted',reason:'时间不足或与前一个动作冲突'});
          continue;
        }
        ({start,end}=scheduled);
        ({activeStart,activeEnd}=scheduled);
      } else assert(end<=page.endFrame-8,`Gesture ${g.id} runs past its page`);
      activeStart??=start+11;activeEnd??=end-13;
      assert(start>=b.visibleFrom&&(!to||start>=to.visibleFrom),`Gesture target not yet visible: ${g.id}`);
      const paths=plan.schemaVersion>=2&&['circle','orbit','underline','sweep'].includes(g.kind)?boxes.map(rect=>actionPoints(g.kind,rect)):[actionPoints(g.kind,b,to)];
      const {points,strokes}=combinePaths(paths);
      assert(points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>40&&x<1040&&y>10&&y<1420),`Gesture outside paper: ${g.id}`);
      if(anchor)gestureSync.push({pageId:page.id,id:g.id,target:g.target,segment:g.segment,quote:anchor.quote,occurrence:anchor.occurrence,status:'scheduled',wordStartSeconds:anchor.startSeconds,wordEndSeconds:anchor.endSeconds,inkStartSeconds:activeStart/fps,inkEndSeconds:activeEnd/fps});
      page.gestures.push({id:g.id,kind:g.kind,target:g.target,to:g.to,segment:g.segment,quote:anchor?.quote??g.quote,ink:g.ink,
        startFrame:start,endFrame:end,activeStart,activeEnd,points,...(plan.schemaVersion>=2?{intent:g.intent,strokes}:{}),
        entry:[1190,Math.min(1390,points[0][1]+180)],exit:[1190,Math.min(1390,points.at(-1)[1]+150)]});
    }
    page.gestures.sort((a,b)=>a.startFrame-b.startFrame);
    page.gestures.forEach((g,i)=>assert(!i||g.startFrame>=page.gestures[i-1].endFrame+6,`Pen gestures overlap or have no pause: ${g.id}`));
    page.board={width:1080,height:1920,fps,duration:cursor/fps,paper,items};delete page.items;
  }
  const output={schemaVersion:1,kind:'paper-lesson',width:1080,height:1920,fps,durationFrames:cursor,duration:cursor/fps,
    sourceHash:source.sha256,sourceText:source.text,sourceSegments:source.segments,timingMode:audio?'audio-subtitles':'estimated',unitsPerSecond:rate,planSchemaVersion:plan.schemaVersion,
    ...(audio?{audioTiming:audio}:{}),
    ...(audio?.alignment?{gestureSync}:{}),
    pages,captions,segmentTimings:timings};
  assert(captions.map(c=>c.text).join('')===source.text,'Subtitle source coverage mismatch');
  return configureVideo(output,video);
}
export function makeSrt(lesson) {
  const stamp=frame=>{const ms=Math.round(frame/lesson.fps*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
  return lesson.captions.map((c,i)=>`${i+1}\n${stamp(c.startFrame)} --> ${stamp(c.endFrame)}\n${c.lines.join('\n')}\n`).join('\n');
}
