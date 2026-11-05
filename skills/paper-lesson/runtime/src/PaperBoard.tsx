import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, Img, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import rough from 'roughjs';
import type {BoardData, ShapeItem} from './types';

let fontPromise: Promise<void> | undefined;
function loadHandwriting() {
  fontPromise ??= new FontFace('PaperHand', `url("${staticFile('fonts/ChillZhuo.ttf')}")`)
    .load().then((face) => {document.fonts.add(face);});
  return fontPromise;
}
function useHandwriting() {
  const [handle] = useState(() => delayRender('Loading the local handwriting font'));
  useEffect(() => {loadHandwriting().then(() => continueRender(handle)).catch(cancelRender);}, [handle]);
}
function InkPath({item, ink}: {item: ShapeItem; ink: string}) {
  const paths = useMemo(() => {
    const generator = rough.generator();
    return generator.toPaths(generator.path(item.path, {
      seed: item.seed, stroke: item.color ?? ink, strokeWidth: item.width ?? 2.8,
      roughness: item.roughness ?? 0.7, bowing: 0.3, disableMultiStroke: true,
      preserveVertices: true, fill: undefined,
    }));
  }, [item, ink]);
  return <g strokeLinecap="round" strokeLinejoin="round">
    {paths.map((p, i) => <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill="none" />)}
  </g>;
}
export const PaperBoard: React.FC<{board: BoardData;children?:React.ReactNode;background?:string;outputSize?:{width:number;height:number}}> = ({board,children,background}) => {
  useHandwriting();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const visible = board.items.filter((item) => frame >= Math.round(item.at * fps));
  const whitePaper = board.paper.finish === 'white';
  return <AbsoluteFill style={{backgroundColor: '#9c8063'}}>
    {background&&<Img src={staticFile(background)} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>}
    <svg width="100%" height="100%" style={{position:'absolute',inset:0}} viewBox={`0 0 ${board.width} ${board.height}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="desk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={whitePaper ? '#76513c' : '#b59b7b'}/><stop offset="0.6" stopColor={whitePaper ? '#67432f' : '#a58c6e'}/><stop offset="1" stopColor={whitePaper ? '#573624' : '#90765b'}/>
        </linearGradient>
        <filter id="wood-grain" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.22" numOctaves="2" seed="27" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/>
        </filter>
        <filter id="paper-grain" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" seed="81" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/>
        </filter>
        <filter id="paper-shadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="4" dy="11" stdDeviation="8" floodColor="#3a2c1e" floodOpacity="0.23"/>
        </filter>
        <linearGradient id="paper-light" x1="0" y1="0" x2="1" y2="0.8">
          <stop offset="0" stopColor={whitePaper ? '#ffffff' : '#fffef8'} stopOpacity={whitePaper ? 0.3 : 0.4}/>
          <stop offset="0.52" stopColor={whitePaper ? '#ffffff' : '#fffef8'} stopOpacity="0.05"/>
          <stop offset="1" stopColor={whitePaper ? '#70757a' : '#8a7657'} stopOpacity={whitePaper ? 0.025 : 0.07}/>
        </linearGradient>
        <radialGradient id="room-light" cx="0.12" cy="0.16" r="1.05">
          <stop offset="0" stopColor={whitePaper ? '#ffffff' : '#fffef6'} stopOpacity={whitePaper ? 0.035 : 0.1}/>
          <stop offset="1" stopColor={whitePaper ? '#525960' : '#675641'} stopOpacity={whitePaper ? 0.012 : 0.055}/>
        </radialGradient>
      </defs>
      {!background&&<><rect width={board.width} height={board.height} fill="url(#desk)"/>
      <rect width={board.width} height={board.height} filter="url(#wood-grain)" opacity="0.11" style={{mixBlendMode: 'multiply'}}/></>}
      <g transform={`translate(0 ${board.paper.top}) rotate(${board.paper.rotation} 540 900)`}>
        {!background&&<><path d="M 27 0 Q 553 2 1053 0 L 1056 1940 L 24 1940 Z" fill={board.paper.color} filter="url(#paper-shadow)"/>
        <path d="M 27 0 Q 553 2 1053 0 L 1056 1940 L 24 1940 Z" fill="url(#paper-light)"/>
        <rect x="28" y="2" width="1024" height="1935" filter="url(#paper-grain)" opacity={whitePaper ? 0.014 : 0.055} style={{mixBlendMode:'multiply'}}/>
        <path d="M 28 1 Q 546 3 1052 1" fill="none" stroke={whitePaper ? '#ffffff' : '#fffdf4'} strokeWidth="2" opacity="0.7"/></>}
        <g fill={board.paper.ink} style={{fontFamily: 'PaperHand', fontWeight: 400}}>
          {visible.map((item) => item.kind === 'text'
            ? <text key={item.id} data-id={item.id} x={item.x} y={item.y} fontSize={item.size}
                fill={item.color ?? board.paper.ink} letterSpacing={item.spacing ?? 0} textAnchor={item.anchor ?? 'start'}
                transform={`rotate(${item.rotate ?? 0} ${item.x} ${item.y})`}>{item.text}</text>
            : <InkPath key={item.id} item={item} ink={board.paper.ink}/>)}
        </g>
        {children}
      </g>
      {!background&&<rect width={board.width} height={board.height} fill="url(#room-light)" style={{pointerEvents:'none'}}/>}
    </svg>
  </AbsoluteFill>;
};
