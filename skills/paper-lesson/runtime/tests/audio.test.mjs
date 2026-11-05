import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSrt,timedText} from '../scripts/lib/audio.mjs';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
import {hash} from '../scripts/lib/text.mjs';
const srt='1\r\n00:00:00,000 --> 00:00:02,000\r\n先画重点。(breath)\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,900\r\n然后完成任务。\r\n';
const timed=timedText(parseSrt(srt),5.3);
const source={schemaVersion:1,...timed,sha256:hash(timed.text),timingMode:'subtitles',audio:{path:'unused.mp3',duration:5.3,sha256:'test'}};
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const plan={schemaVersion:3,sourceHash:source.sha256,pages:source.segments.map((s,i)=>({id:'p'+i,title:'讲解',layout:'mixed',segments:[s.id],elements:[{id:'e'+i,kind:'section',title:'重点',rows:[{id:'r'+i,kind:'text',runs:[{text:'完成任务',red:true}]}]}],gestures:[{id:'g'+i,kind:'circle',intent:'emphasize',target:'r'+i,segment:s.id,ink:true,offset:999,duration:999}]}))};

test('SRT uses cue times, strips known stage directions, preserves spoken text and pauses',()=>{
  assert.equal(timed.text,'先画重点。\n然后完成任务。');
  assert.deepEqual(source.segments.map(s=>[s.startSeconds,s.endSeconds]),[[0,2],[3,4.9]]);
  assert.throws(()=>parseSrt(srt.replace('00:00:03,000','00:00:01,900')),/overlapping/);
  assert.throws(()=>timedText(parseSrt(srt),4),/exceed/);
  assert.throws(()=>parseSrt(''),/timestamp/);
  assert.equal(parseSrt('1\n00:00:00,000 --> 00:00:01,000\n保留（解释）和 (example)。')[0].text,'保留（解释）和 (example)。');
});
test('audio drives total duration, caption timing and page changes at 30/60fps; ignores LLM seconds',()=>{
  for(const fps of [30,60]) {
    const lesson=compileLesson(source,plan,metrics,{quality:'4K',fps});
    assert.ok(validateLesson(lesson));
    assert.equal(lesson.durationFrames,Math.ceil(5.3*fps));
    assert.equal(lesson.pages[1].startFrame,Math.round(2.6*fps));
    assert.deepEqual(lesson.captions.map(c=>[c.startFrame,c.endFrame]),[[0,2*fps],[3*fps,Math.round(4.9*fps)]]);
    assert.equal(lesson.pages[0].targets.r0.visibleFrom,0);
    assert.equal(lesson.audio,source.audio);
    for(const p of lesson.pages)assert.ok(p.gestures[0].endFrame<=p.endFrame);
  }
});
test('crowded audio pen actions are fitted deterministically without adding silence',()=>{
  const p=structuredClone(plan);p.pages[0].gestures.push({...p.pages[0].gestures[0],id:'second'});
  const lesson=compileLesson(source,p,metrics,{quality:'4K',fps:30});
  assert.ok(validateLesson(lesson));assert.equal(lesson.durationFrames,159);
  const gestures=lesson.pages[0].gestures;
  assert.ok(gestures[0].endFrame<gestures[1].startFrame);
  assert.ok(lesson.timingAdjustments.length);
  assert.deepEqual(compileLesson(source,p,metrics,{quality:'4K',fps:30}),lesson);
});
test('invalid timing never silently falls back to estimated narration',()=>{
  const bad=structuredClone(source);delete bad.segments[0].startSeconds;
  assert.throws(()=>compileLesson(bad,plan,metrics),/Invalid subtitle timing/);
});
