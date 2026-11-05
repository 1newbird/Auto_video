import {hash,visualUnits} from './text.mjs';
export function validateLesson(lesson) {
  const must=(ok,message)=>{if(!ok)throw new Error(message);};
  must(lesson.schemaVersion===1&&lesson.kind==='paper-lesson','Unsupported lesson schema');
  must(lesson.showCaptions===undefined||typeof lesson.showCaptions==='boolean','showCaptions must be boolean');
  must([[1080,1920],[1440,2560],[2160,3840]].some(([w,h])=>lesson.width===w&&lesson.height===h)&&[30,60].includes(lesson.fps),'Expected portrait 1080p/1440p/4K at 30/60 fps');
  must(Number.isInteger(lesson.durationFrames)&&lesson.durationFrames>0&&lesson.durationFrames<=lesson.fps*1800,'Invalid duration (limit 30 minutes)');
  must(hash(lesson.sourceText)===lesson.sourceHash,'Compiled source hash mismatch');
  let end=0;
  for(const page of lesson.pages) {
    must(page.startFrame===end&&page.endFrame>page.startFrame,'Page intervals must be contiguous');end=page.endFrame;
    must(page.board.width===lesson.width&&page.board.height===lesson.height&&page.board.fps===lesson.fps,'Board output settings differ from lesson');
    must(page.board.items.every(i=>Number.isFinite(i.at)&&Math.round(i.at*lesson.fps)>=page.startFrame&&Math.round(i.at*lesson.fps)<page.endFrame),'Board reveal outside page');
    for(const target of Object.values(page.targets)) {
      must(target.x>=60&&target.x+target.w<=1020&&target.y>=0&&target.y+target.h<=1420,'Board exceeds content area');
      must(lesson.timingMode==='audio-subtitles'?target.visibleFrom<=lesson.segmentTimings[target.segment].startFrame:target.visibleFrom<lesson.segmentTimings[target.segment].startFrame,'Board text must precede or accompany its narration');
      if(target.rects)must(target.rects.length>0&&target.rects.every(r=>[r.x,r.y,r.w,r.h].every(Number.isFinite)&&r.w>0&&r.h>0&&r.x>=60&&r.x+r.w<=1020&&r.y+r.h<=1420),'Invalid inline target rectangles');
    }
    let penEnd=page.startFrame;
    for(const g of page.gestures) {
      must(g.startFrame>=penEnd&&g.endFrame<=page.endFrame,'Pen gestures overlap or cross page');penEnd=g.endFrame;
      must(g.activeStart>g.startFrame&&g.activeEnd>g.activeStart&&g.endFrame>g.activeEnd,'Invalid gesture phases');
      must(g.startFrame>=page.targets[g.target].visibleFrom,'Pen target must already be visible');
      must(g.points.every(p=>p.length===2&&p.every(Number.isFinite)),'Invalid gesture path');
      if(g.strokes) {
        let previous=0;
        for(const stroke of g.strokes) {
          must(Number.isFinite(stroke.from)&&Number.isFinite(stroke.to)&&stroke.from>=previous&&stroke.to>stroke.from&&stroke.to<=1,'Invalid ink interval');
          must(stroke.points.length>=2&&stroke.points.every(p=>p.length===2&&p.every(Number.isFinite)),'Invalid ink path');previous=stroke.to;
        }
      }
    }
  }
  must(end===lesson.durationFrames,'Pages do not cover the lesson');
  let offset=0,lastEnd=0;
  for(const c of lesson.captions) {
    must(c.sourceStart===offset&&c.text===lesson.sourceText.slice(c.sourceStart,c.sourceEnd),'Caption text differs from source');offset=c.sourceEnd;
    must(Number.isInteger(c.startFrame)&&Number.isInteger(c.endFrame)&&c.startFrame>=lastEnd&&c.endFrame>c.startFrame,'Caption intervals overlap or are invalid');lastEnd=c.endFrame;
    must(c.lines.length>=1&&c.lines.length<=2&&c.lines.every(l=>l.trim()&&visualUnits(l)<=19),'Caption is blank or exceeds two-line safe area');
    must(c.lines.join('').replace(/\s/g,'')===c.text.replace(/\s/g,''),'Caption display drops source text');
  }
  must(offset===lesson.sourceText.length&&lastEnd<=lesson.durationFrames,'Caption coverage incomplete');
  return true;
}
