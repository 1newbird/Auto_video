import React from 'react';
import {AbsoluteFill,useCurrentFrame} from 'remotion';
import {PaperBoard} from './PaperBoard';
import {clamp,gestureState,svgPath} from './gesture-motion';
import type {Gesture,LessonData} from './lesson-types';
function Pen() {
  // Origin is the physical nib. The body extends down/right away from the target.
  return <g transform="rotate(22) scale(0.75)">
    <defs>
      <linearGradient id="pen-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#841a23"/><stop offset=".28" stopColor="#e5787c"/><stop offset=".5" stopColor="#b93b47"/><stop offset="1" stopColor="#6c2028"/>
      </linearGradient>
      <linearGradient id="pen-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#dadcdd"/><stop offset=".5" stopColor="#868c91"/><stop offset="1" stopColor="#e9e9e9"/>
      </linearGradient>
    </defs>
    <path d="M 4 5 L 30 -5 L 233 -5 Q 246 4 234 14 L 30 14 Z" fill="#252324" opacity=".13" transform="translate(3 6)"/>
    <path d="M 0 0 L 28 -7 L 28 7 Z" fill="url(#pen-metal)" stroke="#727478" strokeWidth=".8"/>
    <path d="M 0 0 L 8 -2 L 8 2 Z" fill="#38383a"/>
    <rect x="27" y="-10" width="216" height="20" rx="6" fill="url(#pen-body)" stroke="#852a32" strokeWidth="1"/>
    <rect x="30" y="-9" width="51" height="18" rx="3" fill="#9e3740" opacity=".78"/>
    {[35,42,49,56,63,70].map(x=><path key={x} d={`M ${x} -7 L ${x} 7`} stroke="#e0a3a6" opacity=".4" strokeWidth="1"/>)}
    <path d="M 86 -6 L 226 -6" stroke="#f3b6b8" strokeWidth="2" opacity=".58"/>
    <path d="M 173 -10 L 225 -10 Q 235 -10 235 -5 L 182 -5" fill="#a8a8a9" stroke="#666" strokeWidth=".7"/>
  </g>;
}
export function GestureLayer({gestures,frame}:{gestures:Gesture[];frame:number}) {
  return <g>
    {gestures.filter(g=>g.ink&&frame>=g.activeStart).map(g=>{
      const state=gestureState(g,frame);
      return (g.strokes??[{points:g.points,from:0,to:1}]).map((stroke,i)=>{
        const progress=clamp((state.inkProgress-stroke.from)/(stroke.to-stroke.from));
        return progress>0?<path key={`${g.id}-${i}`} d={svgPath(stroke.points)} fill="none" stroke="#ab3d34" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} strokeDasharray="1" strokeDashoffset={1-progress}/>:null;
      });
    })}
    {gestures.map(g=>{const s=gestureState(g,frame);return s.visible?<g key={g.id} opacity={s.opacity} transform={`translate(${s.point[0]} ${s.point[1]})`}><Pen/></g>:null;})}
  </g>;
}
export const PaperLesson:React.FC<{lesson:LessonData;background?:string;layer?:'full'|'board'|'caption'}>=({lesson,background,layer='full'})=>{
  const frame=useCurrentFrame();
  const page=lesson.pages.find(p=>frame>=p.startFrame&&frame<p.endFrame)??lesson.pages.at(-1)!;
  const caption=lesson.captions.find(c=>frame>=c.startFrame&&frame<c.endFrame);
  return <AbsoluteFill>
    {layer!=='caption'&&<PaperBoard board={page.board} background={background}><GestureLayer gestures={page.gestures} frame={frame}/></PaperBoard>}
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" style={{position:'absolute',inset:0}}>
      {layer!=='caption'&&<text x="89" y="1710" fontFamily="Arial, sans-serif" fontSize="25" fill="#777" opacity=".65">{lesson.pages.indexOf(page)+1} / {lesson.pages.length}</text>}
      {lesson.showCaptions!==false&&layer!=='board'&&caption?.lines.map((line,i)=><text key={`${caption.id}-${i}`} x="540" y={caption.lines.length===1?1635:1598+i*66}
        textAnchor="middle" fontFamily="Microsoft YaHei, sans-serif" fontWeight="700" fontSize="46" fill="#ffe33b" stroke="#151515" strokeWidth="7" paintOrder="stroke" strokeLinejoin="round">{line}</text>)}
    </svg>
  </AbsoluteFill>;
};
