import test from 'node:test';
import assert from 'node:assert/strict';
import {audioSource,normalizedQuote,resolveWordAnchor,scheduleWordGesture} from '../scripts/lib/audio-timeline.mjs';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const cue={id:'s001',text:'先讲背景，再讲重点。',startSeconds:0,endSeconds:5};
cue.words=[...normalizedQuote(cue.text)].map((text,i)=>({text,from:i,to:i+1,startSeconds:.5+i*.3,endSeconds:.75+i*.3}));
const source=audioSource('原稿',{duration:5,cues:[cue],alignment:{engine:'test-acoustic'}});
const makePlan=()=>({schemaVersion:3,sourceHash:source.sha256,pages:[{id:'p1',title:'主题',layout:'mixed',segments:['s001'],elements:[{id:'e',kind:'text',rows:[{id:'target',kind:'text',runs:[{text:'重点'}]}]}],gestures:[{id:'g1',target:'target',segment:'s001',quote:'重点',kind:'circle',intent:'emphasize',ink:true,duration:900,offset:999}]}]});
for(const fps of [30,60])test(`word synchronization ${fps}: ink (not entry) follows the spoken quote`,()=>{
  const lesson=compileLesson(source,makePlan(),metrics,{fps});
  assert.ok(validateLesson(lesson));
  const gesture=lesson.pages[0].gestures[0],anchor=resolveWordAnchor(cue,{quote:'重点'});
  assert.ok(Math.abs(gesture.activeStart/fps-anchor.startSeconds)<=1/30);
  assert.ok(gesture.startFrame<gesture.activeStart);
  assert.ok(gesture.activeStart>lesson.segmentTimings.s001.startFrame+fps);
  assert.equal(lesson.gestureSync[0].status,'scheduled');
  assert.equal(lesson.gestureSync[0].quote,'重点');
  assert.equal(lesson.duration,5);
});
test('missing/ambiguous quote never falls back to cue start',()=>{
  const plan=makePlan();plan.pages[0].gestures[0].quote='不存在';
  const lesson=compileLesson(source,plan,metrics);
  assert.equal(lesson.pages[0].gestures.length,0);
  assert.equal(lesson.gestureSync[0].status,'omitted');
  const repeated={...cue,text:'重点之后又讲重点'};
  assert.throws(()=>resolveWordAnchor(repeated,{quote:'重点'}),/occurrence/);
  assert.throws(()=>resolveWordAnchor({...cue,words:[]},{quote:'重点'}),/缺少/);
});
test('exact target text can anchor an older plan; conflicts are omitted rather than moved to unrelated speech',()=>{
  const plan=makePlan();delete plan.pages[0].gestures[0].quote;
  plan.pages[0].gestures.push({...plan.pages[0].gestures[0],id:'g2'});
  const lesson=compileLesson(source,plan,metrics);
  assert.equal(lesson.pages[0].gestures.length,1);
  assert.deepEqual(lesson.gestureSync.map(x=>x.status),['scheduled','omitted']);
  const first=scheduleWordGesture({startSeconds:0,endSeconds:.5},{startFrame:0,endFrame:60},{startFrame:0,endFrame:60},[{visibleFrom:0}],-6,30);
  assert.equal(first.activeStart,1); // at most one frame late at the beginning of the video
});
