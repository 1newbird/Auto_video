import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {compileLesson,actionPoints} from '../scripts/lib/compile.mjs';
import {hash,normalizeScript,segmentSource,captionChunks,captionLines} from '../scripts/lib/text.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
import {validateBoard} from '../scripts/board.mjs';
import {gestureState,pointAlong} from '../src/gesture-motion.ts';
const source=JSON.parse(fs.readFileSync(new URL('../examples/skill-lesson/source.json',import.meta.url),'utf8'));
const plan=JSON.parse(fs.readFileSync(new URL('../examples/skill-lesson/plan.json',import.meta.url),'utf8'));
const font=spawnSync(process.env.PAPER_LESSON_PYTHON||'python',['scripts/font_metrics.py','public/fonts/ChillZhuo.ttf'],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
assert.equal(font.status,0,font.stderr);const metrics=JSON.parse(font.stdout);
const compile=(p=plan,s=source)=>compileLesson(s,p,metrics);
const clone=()=>structuredClone(plan);
test('real script compiles deterministically and every original character reaches captions',()=>{
  const a=compile(),b=compile();assert.deepEqual(a,b);assert.equal(a.captions.map(c=>c.text).join(''),source.text);assert.ok(validateLesson(a));
});
test('source modification cannot silently reuse a previous plan',()=>{const s=structuredClone(source);s.text+='新增';assert.throws(()=>compile(plan,s),/hash mismatch/);});
test('missing or reordered narration is rejected',()=>{
  const p=clone();p.pages[0].segments.splice(3,1);assert.throws(()=>compile(p),/cover every/);
  const q=clone();q.pages[0].segments.reverse();assert.throws(()=>compile(q),/original order/);
});
test('all red annotations precede their associated narration',()=>{
  const lesson=compile();for(const page of lesson.pages)for(const target of Object.values(page.targets).filter(t=>t.red))assert.ok(target.visibleFrom<=lesson.segmentTimings[target.segment].startFrame-12);
});
test('an emphasis phrase must actually exist in the original segment',()=>{const p=clone();p.pages[0].gestures[0].quote='原稿没有这句话';assert.throws(()=>compile(p),/absent from source/);});
test('the pen cannot point at unrevealed content',()=>{const p=clone();p.pages[0].gestures[0].target='harness-note';assert.throws(()=>compile(p),/not yet visible/);});
test('gestures cannot overlap',()=>{const p=clone();p.pages[0].gestures.push({...p.pages[0].gestures[0],id:'duplicate-time'});assert.throws(()=>compile(p),/overlap/);});
test('ink requires an explicit drawing action',()=>{const p=clone();p.pages[0].gestures[0].ink=true;assert.throws(()=>compile(p),/Only circle\/underline/);});
test('gestures do not spill across page boundaries',()=>{const p=clone();p.pages[0].gestures[0].offset=400;assert.throws(()=>compile(p),/past its page/);});
test('overfull pages fail instead of truncating board text',()=>{const p=clone();p.pages[0].blocks[0].lines[0].text='非常长的板书内容'.repeat(200);assert.throws(()=>compile(p),/overflows/);});
test('flow titles cannot wrap into the detail line',()=>{const p=clone();p.pages[1].steps[0].title='一个过长而且应该拒绝渲染的流程标题'.repeat(2);assert.throws(()=>compile(p),/Flow title too long/);});
test('silent gestures leave no ink before, during or after the movement',()=>{
  const lesson=compile();for(const page of lesson.pages)for(const g of page.gestures.filter(g=>!g.ink))for(let f=g.startFrame-1;f<=g.endFrame+1;f++)assert.equal(gestureState(g,f).inkProgress,0);
});
test('drawing starts at nib, follows the path and persists after pen exit',()=>{
  const g=compile().pages[0].gestures.find(g=>g.ink);
  assert.equal(gestureState(g,g.activeStart-1).inkProgress,0);
  const mid=gestureState(g,Math.floor((g.activeStart+g.activeEnd)/2));assert.ok(mid.inkProgress>0&&mid.inkProgress<1);
  assert.deepEqual(mid.point,pointAlong(g.points,mid.inkProgress));
  assert.equal(gestureState(g,g.endFrame).visible,false);assert.equal(gestureState(g,g.endFrame).inkProgress,1);
});
test('air circle and ink circle share geometry; ink is separate from trajectory',()=>{
  const box={x:100,y:200,w:180,h:40};assert.deepEqual(actionPoints('orbit',box),actionPoints('circle',box));
});
test('paper holds still most of the time',()=>{
  const lesson=compile(),active=lesson.pages.flatMap(p=>p.gestures).reduce((n,g)=>n+g.endFrame-g.startFrame,0);assert.ok(active/lesson.durationFrames<.25);
});
test('normalization only removes formatting and segmented text remains intact',()=>{
  const raw='# 标题\n\u200b\t- 这是 **正文**，使用 `API`；\n下一句。';const text=normalizeScript(raw);
  assert.equal(text,'这是 正文，使用 API；\n下一句。');assert.equal(segmentSource(text).map(s=>s.text).join(''),text);assert.equal(hash(text).length,64);
});
test('old board input formats remain valid',()=>{
  for(const file of ['board.json','skill-loading.json'])assert.doesNotThrow(()=>validateBoard(JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`,import.meta.url),'utf8'))));
});
test('subtitle chunks preserve whitespace without generating an empty caption',()=>{
  for(const text of ['一'.repeat(24)+'\n','记下负责人、截止时间和交付物，其中负责人不能省略。\n']) {
    const chunks=captionChunks(text);assert.equal(chunks.join(''),text);assert.ok(chunks.every(c=>c.trim().length>0));
  }
});
test('subtitle wrapping does not move closing punctuation to a new line',()=>{
  for(const text of ['每条待办要写清负责人、截止时间和交付物','甲'.repeat(24)+'，然后继续。'])for(const chunk of captionChunks(text)) {
    const lines=captionLines(chunk);assert.equal(lines.join('').replace(/\s/g,''),chunk.replace(/\s/g,''));
    assert.ok(lines.every(l=>!/^[，。！？；、：]/.test(l)));
  }
});
