import type {BoardData} from './types';
export type Point=[number,number];
export type Gesture={id:string;kind:string;target:string;ink:boolean;startFrame:number;endFrame:number;activeStart:number;activeEnd:number;fadeFrames?:number;points:Point[];strokes?:{points:Point[];from:number;to:number}[];entry:Point;exit:Point};
export type Caption={id:string;text:string;lines:string[];startFrame:number;endFrame:number;pageId:string};
export type LessonPage={id:string;title:string;startFrame:number;endFrame:number;board:BoardData;gestures:Gesture[]};
export type LessonData={schemaVersion:1;kind:'paper-lesson';width:number;height:number;fps:number;duration:number;durationFrames:number;pages:LessonPage[];captions:Caption[]};
