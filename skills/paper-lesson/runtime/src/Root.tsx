import React from 'react';
import {Composition} from 'remotion';
import {PaperBoard} from './PaperBoard';
import type {BoardData} from './types';
import {PaperLesson} from './PaperLesson';
import type {LessonData} from './lesson-types';
const board:BoardData = {width:1080,height:1920,fps:30,duration:1,paper:{color:'#fff',ink:'#292923',red:'#ab3d34',rotation:-.35,top:100,finish:'white'},items:[]};
const emptyLesson:LessonData={schemaVersion:1,kind:'paper-lesson',width:1080,height:1920,fps:30,duration:1,durationFrames:30,pages:[{id:'preview',title:'',startFrame:0,endFrame:30,board,gestures:[]}],captions:[]};
export const Root: React.FC = () => <><Composition
  id="PaperBoard" component={PaperBoard}
  width={board.width} height={board.height} fps={board.fps}
  durationInFrames={Math.round(board.duration * board.fps)} defaultProps={{board}}
  calculateMetadata={({props}) => ({width: props.outputSize?.width??props.board.width, height: props.outputSize?.height??props.board.height,
    fps: props.board.fps, durationInFrames: Math.round(props.board.duration * props.board.fps)})}
/>
  <Composition id="PaperLesson" component={PaperLesson} width={1080} height={1920} fps={30} durationInFrames={30}
    defaultProps={{lesson:emptyLesson}} calculateMetadata={({props})=>({width:props.lesson.width,height:props.lesson.height,fps:props.lesson.fps,durationInFrames:props.lesson.durationFrames})}/>
</>;
