import type {Gesture,Point} from './lesson-types';
export const clamp=(v:number)=>Math.max(0,Math.min(1,v));
export const ease=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
export function pointAlong(points:Point[],progress:number):Point {
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
  const total=lengths.reduce((a,b)=>a+b,0);let distance=clamp(progress)*total;
  if(!total)return points[0];
  for(let i=0;i<lengths.length;i++) {
    if(distance<=lengths[i]||i===lengths.length-1) {
      const t=lengths[i]?distance/lengths[i]:0;
      return [points[i][0]+(points[i+1][0]-points[i][0])*t,points[i][1]+(points[i+1][1]-points[i][1])*t];
    }
    distance-=lengths[i];
  }
  return points.at(-1)!;
}
export function gestureState(g:Gesture,frame:number) {
  const progress=ease((frame-g.activeStart)/(g.activeEnd-g.activeStart));
  let point:Point;
  if(frame<g.activeStart)point=pointAlong([g.entry,g.points[0]],ease((frame-g.startFrame)/(g.activeStart-g.startFrame)));
  else if(frame>g.activeEnd)point=pointAlong([g.points.at(-1)!,g.exit],ease((frame-g.activeEnd)/(g.endFrame-g.activeEnd)));
  else point=pointAlong(g.points,progress);
  return {point,progress,visible:frame>=g.startFrame&&frame<g.endFrame,
    opacity:g.fadeFrames===0?1:Math.min(clamp((frame-g.startFrame)/(g.fadeFrames??4)),clamp((g.endFrame-frame)/(g.fadeFrames??4))),
    inkProgress:g.ink&&frame>=g.activeStart?progress:0};
}
export const svgPath=(points:Point[])=>points.map(([x,y],i)=>`${i?'L':'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
