import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
import {renderTimeline,boardState} from '../scripts/lib/render-timeline.mjs';
import {hash,segmentSource} from '../scripts/lib/text.mjs';
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
  for(const edit of [p=>p.pages[0].elements[0].x=123,p=>p.pages[0].elements[3].links[0].to='missing',p=>p.pages[0].elements[0].rows[0].runs[0].text='太长'.repeat(2000)]) {
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
test('section headings around a local comparison are laid out by available space, not nesting count',()=>{
  const p=base();p.pages[0].gestures=[];
  p.pages[0].elements=[{id:'chapter',kind:'section',title:'5. 两种方案',elements:[
    {id:'compare',kind:'parallel',reason:'比较两个方案',groups:['left','right'].map((side,i)=>[
      {id:side,kind:'section',title:`方案${i+1}`,elements:[
        {id:`${side}-detail`,kind:'section',title:'适用条件',elements:[
          {id:`${side}-text`,kind:'text',rows:[row(`${side}-row`,'保留完整条件')]}
        ]}
      ]}
    ])}
  ]}];
  const lesson=compile(p),page=lesson.pages[0],t=page.targets;
  assert.ok(validateLesson(lesson));
  assert.equal(t['left-row'].y,t['right-row'].y);
  assert.ok(t['left-row'].x>t.left.x&&t['right-row'].x>t.right.x);
  assert.ok(t['left-row'].x+t['left-row'].w<t['right-row'].x);
  for(const target of Object.values(t))assert.ok(target.x>=40&&target.x+target.w<=1040&&target.y+target.h<=1510);
});

test('compilation reports independent page errors in one pass and returns no partial lesson',()=>{
  const p=base();p.pages=source.segments.map((s,i)=>({
    id:`page-${i}`,title:'说明',layout:'mixed',segments:[s.id],gestures:[],
    elements:[{id:`element-${i}`,kind:'text',rows:[row(`row-${i}`,'保留正文')],...(i<2?{unsupported:true}:{})}]
  }));
  assert.throws(()=>compile(p),error=>{
    assert.equal(error.issues.length,2);
    assert.deepEqual(error.issues.map(i=>i.pageIndex),[0,1]);
    assert.match(error.message,/pages\[0\].*Unknown text field/);
    assert.match(error.message,/pages\[1\].*Unknown text field/);return true;
  });
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

test('crowded mixed text shrinks before rejecting and preserves every row',()=>{
  const p=base();p.pages[0].gestures=[];
  p.pages[0].elements=[{id:'section',kind:'section',title:'1. 全部要点',elements:[
    {id:'body',kind:'text',rows:Array.from({length:22},(_,i)=>row(`r${i}`,`第${i+1}项完整内容`))}
  ]}];
  const l=compile(p),page=l.pages[0];assert.ok(validateLesson(l));
  assert.equal(page.board.items.filter(i=>i.id.startsWith('r')&&i.kind==='text').length,22);
  assert.ok(page.board.items.find(i=>i.id==='r21:fragment:0').size<40);
  for(const t of Object.values(page.targets))assert.ok(t.y+t.h<=1510);
});
