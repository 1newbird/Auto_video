import test from 'node:test';
import assert from 'node:assert/strict';
import {audioSource} from '../scripts/lib/audio-timeline.mjs';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const source=audioSource('原稿措辞不同',{duration:7.05,cues:[
  {id:'s001',text:'第一段讲解。',startSeconds:0,endSeconds:2},
  {id:'s002',text:'第二段继续讲解。',startSeconds:3,endSeconds:5},
  {id:'s003',text:'结束。',startSeconds:6,endSeconds:6.5}]});
const page=(id,segments)=>({id,title:'测试',layout:'mixed',segments,elements:[{id:'node',kind:'text',segment:segments[0],rows:[{id:'row',kind:'text',runs:[{text:'关键内容'}]}]}],gestures:[{id:'g1',segment:segments[0],target:'row',kind:'circle',intent:'emphasize',ink:true,duration:500,offset:999,quote:'不存在的词'}]});
for(const fps of [30,60])test(`audio ${fps}fps: real cue boundaries override model seconds, no pre/post roll`,()=>{
  const plan={schemaVersion:3,sourceHash:source.sha256,unitsPerSecond:-100,pages:[page('p1',['s001','s002']),page('p2',['s003'])]};
  // A competing action has insufficient remaining room; it must not extend the audio.
  plan.pages[0].gestures.push({...plan.pages[0].gestures[0],id:'g2'});
  const lesson=compileLesson(source,plan,metrics,{fps});
  assert.ok(validateLesson(lesson));
  assert.equal(lesson.timingMode,'audio-subtitles');
  assert.equal(lesson.segmentTimings.s002.startFrame,3*fps);
  assert.equal(lesson.segmentTimings.s002.endFrame,5*fps);
  assert.equal(lesson.pages[1].startFrame,6*fps);
  assert.ok(Math.abs(lesson.duration-7.05)<1/30);
  assert.equal(lesson.pages[0].gestures.length,1);
  assert.equal(lesson.pages[0].gestures[0].startFrame,0);
  assert.equal(lesson.pages[0].gestures[0].endFrame,1.8*fps);
  assert.equal(lesson.pages[1].gestures.length,0);
  assert.equal(lesson.captions.map(c=>c.text).join(''),source.text);
  assert.equal(lesson.captions.filter(c=>c.segment==='s002')[0].startFrame,3*fps);
});
test('invalid audio cue order and missing plan anchors fail clearly',()=>{
  assert.throws(()=>audioSource('',{duration:2,cues:[{id:'s001',text:'字',startSeconds:1,endSeconds:.5}]}),/Invalid audio cue/);
  assert.throws(()=>compileLesson(source,{schemaVersion:3,sourceHash:source.sha256,pages:[page('p1',['s001'])]},metrics),/cover every source segment/);
});
