import {hash} from './text.mjs';
const omit=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)));
// Content-addressed keys omit absolute timing when only the visible state matters.
export function boardState(lesson,frame) {
  const index=lesson.pages.findIndex(p=>frame>=p.startFrame&&frame<p.endFrame),page=lesson.pages[index];
  if(!page)throw new Error('Frame outside lesson');
  return {paper:page.board.paper,width:lesson.width,height:lesson.height,pageNumber:index+1,pageCount:lesson.pages.length,
    items:page.board.items.filter(i=>Math.round(i.at*lesson.fps)<=frame).map(i=>omit(i,['at'])),
    ink:page.gestures.filter(g=>g.ink&&frame>=g.endFrame).map(g=>({points:g.points,strokes:g.strokes})),
  };
}
export function dynamicState(lesson,start,end) {
  const page=lesson.pages.find(p=>start>=p.startFrame&&start<p.endFrame);
  return {base:boardState(lesson,start),frames:end-start,
    reveals:page.board.items.filter(i=>Math.round(i.at*lesson.fps)>start&&Math.round(i.at*lesson.fps)<end).map(i=>({...i,at:Math.round(i.at*lesson.fps)-start})),
    gestures:page.gestures.filter(g=>g.startFrame<end&&g.endFrame>start).map(g=>({...g,startFrame:g.startFrame-start,endFrame:g.endFrame-start,activeStart:g.activeStart-start,activeEnd:g.activeEnd-start})),
  };
}
export function renderTimeline(lesson,range=[0,lesson.durationFrames-1]) {
  const [start,last]=range,end=last+1,board=[],captions=[];
  for(const page of lesson.pages) {
    const a=Math.max(start,page.startFrame),b=Math.min(end,page.endFrame);if(a>=b)continue;
    const cuts=new Set([a,b]);
    page.board.items.forEach(i=>cuts.add(Math.round(i.at*lesson.fps)));
    page.gestures.forEach(g=>{cuts.add(g.startFrame);cuts.add(g.endFrame);});
    const sorted=[...cuts].filter(f=>f>=a&&f<=b).sort((x,y)=>x-y);
    for(let i=0;i<sorted.length-1;i++) {
      const from=sorted[i],to=sorted[i+1],dynamic=page.gestures.some(g=>from<g.endFrame&&to>g.startFrame);
      // Keep a gesture in one render call, including any board reveals during it.
      const prev=board.at(-1);
      if(dynamic&&prev?.dynamic&&prev.end===from&&prev.pageId===page.id){prev.end=to;prev.key=hash(JSON.stringify(dynamicState(lesson,prev.start,to)));}
      else board.push({start:from,end:to,dynamic,pageId:page.id,key:hash(JSON.stringify(dynamic?dynamicState(lesson,from,to):boardState(lesson,from)))});
    }
  }
  let cursor=start;
  for(const c of lesson.showCaptions===false?[]:lesson.captions) {
    const a=Math.max(start,c.startFrame),b=Math.min(end,c.endFrame);if(a>=b)continue;
    if(a>cursor)captions.push({start:cursor,end:a,lines:[],key:hash('[]')});
    captions.push({start:a,end:b,lines:c.lines,key:hash(JSON.stringify(c.lines))});cursor=b;
  }
  if(cursor<end)captions.push({start:cursor,end,lines:[],key:hash('[]')});
  return {board,captions,start,end};
}
