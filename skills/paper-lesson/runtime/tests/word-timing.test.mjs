import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../scripts/lib/text.mjs';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
import {validateWordTimings,quoteTiming,wordCaptionBoundaries} from '../scripts/lib/word-timing.mjs';
import {gestureState} from '../src/gesture-motion.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ensureWordAlignment} from '../../scripts/alignment.mjs';
const text='今天讲重点。';
const segment={id:'s001',text,start:0,end:text.length,startSeconds:0,endSeconds:6};
const source={schemaVersion:1,text,sha256:hash(text),segments:[segment],timingMode:'subtitles',audio:{path:'unused',sha256:'audio',duration:6.4}};
const data={schemaVersion:1,sourceHash:source.sha256,audioHash:'audio',cueTimes:[['s001',0,6]],method:'test-supplied-word-times',segments:{s001:[
  {text:'今天',start:0,end:2,startSeconds:0,endSeconds:.4},
  {text:'讲',start:2,end:3,startSeconds:.5,endSeconds:.8},
  {text:'重点',start:3,end:5,startSeconds:4.2,endSeconds:5.2},
  {text:'。',start:5,end:6,startSeconds:5.2,endSeconds:5.2}
]}};
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const plan={schemaVersion:3,sourceHash:source.sha256,pages:[{id:'p',title:'重点',layout:'mixed',segments:['s001'],elements:[{id:'r',kind:'section',title:'关键词',rows:[{id:'word',kind:'text',runs:[{text:'重点',red:true}]}]}],gestures:[{id:'g',kind:'circle',intent:'emphasize',target:'word',segment:'s001',quote:'重点',ink:true}]}]};

test('actual ink onset follows supplied word time, not proportional character position or pen arrival',()=>{
  for(const fps of [30,60]) {
    const lesson=compileLesson(source,plan,metrics,{quality:'4K',fps,wordTimings:data});
    assert.ok(validateLesson(lesson));
    const g=lesson.pages[0].gestures[0];
    assert.equal(g.activeStart,Math.round(4.2*fps));
    assert.ok(g.startFrame<g.activeStart);
    assert.equal(gestureState(g,g.activeStart-1).inkProgress,0);
    assert.ok(gestureState(g,g.activeStart+1).inkProgress>0);
    assert.equal(lesson.gestureTiming,'word-aligned');
  }
});
test('a keyword spoken at zero can draw immediately without NaN opacity or delayed arrival',()=>{
  const p=structuredClone(plan);p.pages[0].gestures[0].quote='今天';
  const lesson=compileLesson(source,p,metrics,{quality:'4K',fps:30,wordTimings:data});
  assert.ok(validateLesson(lesson));const g=lesson.pages[0].gestures[0];
  assert.equal(g.startFrame,0);assert.equal(g.activeStart,0);
  assert.equal(gestureState(g,0).opacity,1);
});
test('conflicting keyword actions are reported instead of silently shifted away from speech',()=>{
  const p=structuredClone(plan);p.pages[0].gestures.push({...p.pages[0].gestures[0],id:'duplicate'});
  assert.throws(()=>compileLesson(source,p,metrics,{quality:'4K',fps:30,wordTimings:data}),/Overlapping keyword/);
});
test('timings validate audio, text, cue boundaries, exact offsets and zero-length anchors',()=>{
  assert.equal(validateWordTimings(source,data),data);
  for(const edit of [d=>d.audioHash='wrong',d=>d.cueTimes[0][2]=7,d=>d.segments.s001[0].text='改稿',d=>d.segments.s001[1].startSeconds=-1]) {
    const bad=structuredClone(data);edit(bad);assert.throws(()=>validateWordTimings(source,bad));
  }
  const bad=structuredClone(data);bad.segments.s001[2].endSeconds=4.2;
  assert.throws(()=>quoteTiming(segment,'重点',bad),/No usable audio timing/);
  assert.throws(()=>quoteTiming(segment,'不存在',data),/Absent/);
});
test('short subtitle boundaries use word times while preserving original SRT endpoints and text',()=>{
  assert.deepEqual(wordCaptionBoundaries(segment,['今天讲','重点。'],data,30),[0,126,180]);
  assert.deepEqual(wordCaptionBoundaries(segment,['今天讲','重点。'],data,60),[0,252,360]);
});
test('imported/cached word times avoid installing or loading an acoustic model; changed audio is rejected',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'word-alignment-test-'));
  t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('word-alignment-test-'));await fs.rm(dir,{recursive:true,force:true});});
  const job=path.join(dir,'job');await fs.mkdir(job);
  const audio=path.join(job,'narration.bin');await fs.writeFile(audio,'test-audio');
  const s=structuredClone(source);s.audio={...s.audio,path:audio,sha256:hash('test-audio')};
  const d=structuredClone(data);d.audioHash=s.audio.sha256;
  await fs.writeFile(path.join(job,'source.json'),JSON.stringify(s));
  const file=path.join(dir,'provided.json');await fs.writeFile(file,JSON.stringify(d));
  const args={job,outputRoot:dir,python:'must-not-run'};
  const result=await ensureWordAlignment({...args,importFile:file});
  assert.deepEqual(JSON.parse(await fs.readFile(result,'utf8')),d);
  assert.equal(await ensureWordAlignment(args),result);
  await assert.rejects(fs.access(path.join(dir,'.paper-lesson-align')));
  await fs.writeFile(audio,'changed');await assert.rejects(ensureWordAlignment(args),/Narration changed|narration changed/);
});
