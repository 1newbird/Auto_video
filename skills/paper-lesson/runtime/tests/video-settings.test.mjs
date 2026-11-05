import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {videoOptions} from '../scripts/lib/video-options.mjs';
import {resolveVideoOptions} from '../../scripts/settings.mjs';
import {compileLesson,makeSrt} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
import {renderTimeline} from '../scripts/lib/render-timeline.mjs';
import {gestureState} from '../src/gesture-motion.ts';
import {hash,segmentSource} from '../scripts/lib/text.mjs';
const text='先圈出重点，再按箭头完成任务。';
const source={schemaVersion:1,text,sha256:hash(text),segments:segmentSource(text)};
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const plan={schemaVersion:3,sourceHash:source.sha256,pages:[{id:'p',title:'按步骤完成',layout:'mixed',segments:['s001'],elements:[
  {id:'flow',kind:'flow',nodes:[{id:'a',title:'明确目标',red:true},{id:'b',title:'完成任务'}]}
],gestures:[{id:'g',kind:'circle',intent:'emphasize',target:'a',segment:'s001',duration:1.6,ink:true}]}]};

test('video presets default to 4K/30, validate choices and read Chinese settings',async t=>{
  assert.deepEqual(videoOptions(),{quality:'4K',width:2160,height:3840,fps:30});
  for(const [quality,width,height] of [['1080p',1080,1920],['1440p',1440,2560],['4K',2160,3840]])for(const fps of [30,60])assert.deepEqual(videoOptions(quality,fps),{quality,width,height,fps});
  for(const args of [['8K',30],['4K',24],['4K','60'],[null,30]])assert.throws(()=>videoOptions(...args));
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paper-video-settings-'));
  t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('paper-video-settings-'));await fs.rm(dir,{recursive:true,force:true});});
  const file=path.join(dir,'settings.json');
  await fs.writeFile(file,JSON.stringify({outputDir:'unused','清晰度':'1440p','帧率':60,'_说明':'ignored'}));
  assert.deepEqual(await resolveVideoOptions({},file),videoOptions('1440p',60));
  assert.deepEqual(await resolveVideoOptions({quality:'4K',fps:30},file),videoOptions());
  await fs.writeFile(file,JSON.stringify({outputDir:'unused'}));
  assert.deepEqual(await resolveVideoOptions({},file),videoOptions());
});

test('output resolution preserves board geometry; 60fps preserves timing and adds motion samples',()=>{
  const low=compileLesson(source,plan,metrics,videoOptions('1080p',30));
  for(const quality of ['1080p','1440p','4K'])for(const fps of [30,60]) {
    const lesson=compileLesson(source,plan,metrics,videoOptions(quality,fps));
    assert.ok(validateLesson(lesson));
    assert.equal(lesson.duration,low.duration);
    assert.equal(lesson.durationFrames,low.durationFrames*fps/30);
    assert.deepEqual(lesson.pages[0].board.items,low.pages[0].board.items);
    assert.equal(makeSrt(lesson),makeSrt(low));
    assert.equal(lesson.captions.map(c=>c.text).join(''),text);
    const a=low.pages[0].gestures[0],b=lesson.pages[0].gestures[0];
    for(let frame=a.startFrame;frame<=a.endFrame;frame++)assert.deepEqual(gestureState(b,frame*fps/30),gestureState(a,frame));
    const timeline=renderTimeline(lesson);
    assert.equal(timeline.board.filter(s=>s.dynamic).reduce((n,s)=>n+s.end-s.start,0),1.6*fps);
    if(fps===60)assert.notDeepEqual(gestureState(b,b.activeStart+1).point,gestureState(b,b.activeStart+2).point);
    assert.equal(timeline.captions.at(-1).end,lesson.durationFrames);
  }
});
