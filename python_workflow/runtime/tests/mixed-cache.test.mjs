import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
import {renderTimeline,boardState} from '../scripts/lib/render-timeline.mjs';
import {hash,segmentSource} from '../scripts/lib/text.mjs';
import {audioSource} from '../scripts/lib/audio-timeline.mjs';
import {splitForCapacity} from '../scripts/lib/page-capacity.mjs';
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const text='先确定目标，把需要执行的步骤组织起来，逐项完成任务。再根据实际需要，读取对应的资料，使用已经保存的经验。最后核对结果，保留可复用的内容，方便下一次使用。';
const source={schemaVersion:1,text,sha256:hash(text),segments:segmentSource(text)};
const row=(id,text,extra={})=>({id,kind:'text',runs:[{text}],...extra});
const base=()=>({schemaVersion:3,sourceHash:source.sha256,pages:[{id:'p',title:'组织与复用',layout:'mixed',segments:source.segments.map(s=>s.id),elements:[
  {id:'intro',kind:'section',title:'先确定目标',rows:[row('a','让步骤和目标对应。')]},
  {id:'flow',kind:'flow',nodes:[{id:'one',title:'准备'},{id:'two',title:'执行'},{id:'three',title:'核对'}]},
  {id:'tree',kind:'tree',segment:'s002',rows:[row('root','资料',{children:[row('child','按需读取')]})]},
  {id:'rel',kind:'relation',segment:'s003',nodes:[{id:'agent',title:'运行机制'},{id:'skill',title:'技能'}],links:[{from:'agent',to:'skill',label:'加载'}]},
],gestures:[{id:'g',kind:'underline',intent:'emphasize',target:'child',segment:'s002',duration:2.6,ink:true}]}]});
const compile=p=>compileLesson(source,p,metrics);

for(const direction of ['horizontal','vertical'])test(`labeled ${direction} flow measures and wraps labels without dropping them`,()=>{
  const p=base();p.pages[0].gestures=[];p.pages[0].elements=[{id:'f',kind:'flow',direction,
    nodes:[{id:'n1',title:'程序'},{id:'n2',title:'服务'},{id:'n3',title:'结果'}],
    links:[{from:'n1',to:'n2',label:'调用'},{from:'n2',to:'n3',label:'返回经过处理的结果'}]}];
  const lesson=compile(p),page=lesson.pages[0];assert.ok(validateLesson(lesson));
  for(const [i,label] of ['调用','返回经过处理的结果'].entries()) {
    const target=page.targets[`f:label:${i}`];assert.ok(target);
    assert.equal(page.board.items.filter(t=>t.id.startsWith(`f:label:${i}-`)).map(t=>t.text).join(''),label);
    for(const node of ['n1','n2','n3'].map(id=>page.targets[id]))assert.ok(target.x+target.w<=node.x||target.x>=node.x+node.w||target.y+target.h<=node.y||target.y>=node.y+node.h);
  }
});

test('capacity split preserves narration, blocks, gesture targets and source plan',()=>{
  const s=audioSource('稿件',{duration:20,cues:[{id:'s001',text:'先解释第一部分。',startSeconds:0,endSeconds:10},{id:'s002',text:'再解释第二部分。',startSeconds:10,endSeconds:20}]});
  const elements=[0,1].map(i=>({id:`block${i}`,kind:'text',segment:`s00${i+1}`,rows:Array.from({length:14},(_,j)=>row(`r${i}-${j}`,`保留说明${j}`))}));
  const p={schemaVersion:3,sourceHash:s.sha256,pages:[{id:'full',title:'完整内容',layout:'mixed',segments:['s001','s002'],elements:[{id:'sec',kind:'section',title:'原有分组',elements}],gestures:[{id:'g',target:'r1-0',segment:'s002',kind:'underline',intent:'emphasize',ink:true}]}]};
  const original=JSON.stringify(p),lesson=compileLesson(s,p,metrics);
  assert.ok(validateLesson(lesson));assert.equal(JSON.stringify(p),original);
  assert.equal(lesson.pages.length,2);assert.equal(lesson.duration,20);
  assert.equal(lesson.captions.map(c=>c.text).join(''),s.text);
  for(let i=0;i<2;i++)for(let j=0;j<14;j++)assert.ok(lesson.pages[i].targets[`r${i}-${j}`]);
  assert.equal(lesson.pages[1].gestures[0].target,'r1-0');
  const unsafe=structuredClone(p.pages[0]);unsafe.gestures[0].target='r0-0';
  assert.equal(splitForCapacity(unsafe,new Set(['full'])),null);
});

test('dense real page fits text and five-step flow without losing the final note or mutating the plan',()=>{
  const page=JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/dense-page.json',import.meta.url),'utf8'));
  function bind(value) {
    if(!value||typeof value!=='object')return;
    if(value.segment)value.segment=source.segments[0].id;
    Object.values(value).forEach(bind);
  }
  bind(page);page.segments=source.segments.map(s=>s.id);page.gestures=[];
  const plan={schemaVersion:3,sourceHash:source.sha256,pages:[page]},original=JSON.stringify(plan);
  const lesson=compile(plan),result=lesson.pages[0];
  assert.ok(validateLesson(lesson));
  assert.equal(JSON.stringify(plan),original);
  assert.ok(result.layoutFit.textScale<1&&result.layoutFit.textScale>=.8);
  assert.ok(result.targets.simpleRow);
  for(const id of ['nRequest','nScan','nPrompt','nRead','nExecute'])assert.ok(result.targets[id]);
  assert.ok(Object.values(result.targets).every(t=>t.y+t.h<=1420));
  const body=result.board.items.filter(i=>i.kind==='text'&&i.id.includes(':fragment:'));
  assert.ok(body.every(i=>i.size>=32));
});
test('mixed elements stack in reading order, draw real relations, preserve full captions',()=>{
  const lesson=compile(base()),page=lesson.pages[0];assert.ok(validateLesson(lesson));
  assert.ok(page.targets.a.y<page.targets.one.y&&page.targets.one.y<page.targets.root.y&&page.targets.root.y<page.targets.agent.y);
  assert.ok(page.targets.child.x>page.targets.root.x);
  assert.ok(page.board.items.some(i=>i.id==='rel:edge:0'&&i.kind==='path'));
  assert.equal(lesson.captions.map(c=>c.text).join(''),text);
});
test('semantic parallel stays local; default notes stack vertically',()=>{
  const p=base();p.pages[0].gestures=[];p.pages[0].elements=[{id:'compare',kind:'parallel',reason:'比较两种处理方式',groups:[[{id:'left',kind:'text',rows:[row('l','方式一')]}],[{id:'right',kind:'text',rows:[row('r','方式二')]}]]},{id:'after',kind:'text',rows:[row('z','后续说明')]}];
  const targets=compile(p).pages[0].targets;assert.equal(targets.l.y,targets.r.y);assert.ok(targets.l.x<targets.r.x&&targets.z.y>targets.l.y);
  p.pages[0].layout='notes';delete p.pages[0].elements;p.pages[0].blocks=[{id:'b1',title:'一',segment:'s001',rows:[row('a1','先')]},{id:'b2',title:'二',segment:'s002',rows:[row('a2','后')]}];
  const t=compile(p).pages[0].targets;assert.equal(t.b1.x,t.b2.x);assert.ok(t.b1.y<t.b2.y);
});
test('mixed layout rejects unsupported fields, invalid edges and overflow',()=>{
  for(const edit of [p=>p.pages[0].elements[0].x=123,p=>p.pages[0].elements[3].links[0].to='missing',p=>p.pages[0].elements[0].rows[0].runs[0].text='太长'.repeat(500)]) {
    const p=base();edit(p);assert.throws(()=>compile(p),/Unknown|Invalid relation|overflows/);
  }
});

test('numbered section indents nested diagrams, supports red titles and later arrows',()=>{
  const p=base();p.pages[0].gestures=[];
  p.pages[0].elements=[{id:'chapter',kind:'section',title:'1. 按需读取',segment:'s001',elements:[
    {id:'process',kind:'flow',nodes:[{id:'a',title:'判断'},{id:'b',title:'读正文',red:true}],links:[{from:'a',to:'b',segment:'s002'}]},
    {id:'notes',kind:'text',rows:[row('note','需要时再读取参考文件。')]}
  ]}];
  const l=compile(p),page=l.pages[0];assert.ok(validateLesson(l));
  const box=page.board.items.find(i=>i.id==='a:box');assert.match(box.path,/M 139 /);
  assert.equal(page.targets.b.red,true);
  assert.ok(page.board.items.find(i=>i.id==='process:edge:0').at*30>page.targets.b.visibleFrom);
  const broken=structuredClone(p);broken.pages[0].elements[0].segment='s002';broken.pages[0].elements[0].elements[0].segment='s001';
  assert.throws(()=>compile(broken),/Section child precedes heading/);
});
test('timeline covers every frame, only gestures require continuous rendering',()=>{
  const l=compile(base()),tl=renderTimeline(l),g=l.pages[0].gestures[0];
  for(const list of [tl.board,tl.captions]){assert.equal(list[0].start,0);assert.equal(list.at(-1).end,l.durationFrames);for(let i=1;i<list.length;i++)assert.equal(list[i-1].end,list[i].start);}
  assert.equal(tl.board.filter(s=>s.dynamic).reduce((n,s)=>n+s.end-s.start,0),g.endFrame-g.startFrame);
  assert.equal(boardState(l,g.endFrame).ink.length,1);
  const clip=renderTimeline(l,[g.startFrame+7,g.endFrame+10]);assert.equal(clip.board[0].start,g.startFrame+7);assert.equal(clip.board.at(-1).end,g.endFrame+11);
});
test('subtitle edits reuse boards; changed visible content and ink invalidate affected assets',()=>{
  const l=compile(base()),original=renderTimeline(l),edit=structuredClone(l);edit.captions[0].lines=['新字幕'];
  assert.deepEqual(renderTimeline(edit).board,original.board);assert.notEqual(renderTimeline(edit).captions[1].key,original.captions[1].key);
  const last=l.pages[0].board.items.find(i=>i.id==='skill-0'),changed=structuredClone(l);changed.pages[0].board.items.find(i=>i.id===last.id).text='新经验';
  const next=renderTimeline(changed);for(let i=0;i<original.board.length;i++)assert.equal(next.board[i].key===original.board[i].key,original.board[i].start<Math.round(last.at*30));
  const moved=structuredClone(l);moved.pages[0].gestures[0].points[0][0]+=4;
  assert.notEqual(renderTimeline(moved).board.find(s=>s.dynamic).key,original.board.find(s=>s.dynamic).key);
});

test('five vertical nodes are preserved without shrinking when the page has room',()=>{
  const p=base();p.pages[0].gestures=[];
  p.pages[0].elements=[{id:'five',kind:'flow',direction:'vertical',nodes:Array.from({length:5},(_,i)=>({id:`n${i}`,title:`步骤${i+1}`,detail:'说明'}))}];
  const l=compile(p),page=l.pages[0];assert.ok(validateLesson(l));
  assert.equal(page.board.items.filter(i=>i.id.endsWith(':box')).length,5);
  assert.equal(page.board.items.find(i=>i.id==='n4-0').size,38);
  assert.ok(page.targets.n4.y>page.targets.n3.y);
});

test('crowded vertical flow shrinks fonts and spacing while preserving later notes and gesture targets',()=>{
  const p=base();
  p.pages[0].elements=[{id:'chapter',kind:'section',title:'1. 全部步骤',elements:[
    {id:'many',kind:'flow',direction:'vertical',nodes:Array.from({length:8},(_,i)=>({id:`n${i}`,title:`步骤${i+1}`,detail:'保留完整说明'}))},
    {id:'tail',kind:'note',rows:[row('tailrow','流程后的说明也要完整保留。')]}
  ]}];
  p.pages[0].gestures=[{id:'g',kind:'circle',intent:'emphasize',target:'n7',segment:'s002',duration:2,ink:true}];
  const l=compile(p),page=l.pages[0];assert.ok(validateLesson(l));
  assert.equal(page.board.items.filter(i=>i.id.endsWith(':box')).length,8);
  assert.equal(page.board.items.filter(i=>i.id.startsWith('many:edge:')).length,7);
  assert.ok(page.board.items.find(i=>i.id==='n7-0').size<38);
  assert.ok(page.board.items.find(i=>i.id==='n7:detail-0').size>=18);
  assert.ok(page.targets.tailrow.y>page.targets.n7.y);
  for(const t of Object.values(page.targets))assert.ok(t.y+t.h<=1510,JSON.stringify(t));
  assert.equal(new Set(page.board.items.map(i=>i.id)).size,page.board.items.length);
  assert.equal(l.captions.map(c=>c.text).join(''),text);
});

test('horizontal diagrams use measured width instead of a node-count limit',()=>{
  const p=base();p.pages[0].gestures=[];
  p.pages[0].elements=[{id:'horizontal',kind:'flow',nodes:Array.from({length:5},(_,i)=>({id:`n${i}`,title:`步骤${i+1}`}))}];
  const l=compile(p),page=l.pages[0];assert.ok(validateLesson(l));
  for(let i=1;i<5;i++)assert.ok(page.targets[`n${i-1}`].x+page.targets[`n${i-1}`].w<page.targets[`n${i}`].x);
});
