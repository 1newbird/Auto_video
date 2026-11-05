import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutRuns,combinePaths} from '../scripts/lib/rich-layout.mjs';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {hash,measure} from '../scripts/lib/text.mjs';

// A small proportional synthetic font keeps these layout tests independent of
// the example topic, font download, operating system and rendering process.
const metrics={unitsPerEm:1000,widths:new Proxy({}, {get:(_,cp)=>Number(cp)<128?500:1000})};
function cells(layout,size) {
  return layout.fragments.flatMap(fragment=>{
    let x=fragment.x;
    return [...fragment.text].map(char=>{
      const value={char,x,y:fragment.y};x+=measure(char,size,metrics);return value;
    });
  });
}
const narration=[
  '先说明一个概念以及对应的解释，让读者完整理解这些文字表达的关系。',
  '接着介绍它的组成部分，同时指出一个值得记住的重要条件。',
  '最后再次回顾前面的内容，说明这些知识点在实际使用时如何联系。',
];
const text=narration.join('');let offset=0;
const source={schemaVersion:1,text,sha256:hash(text),segments:narration.map((text,i)=>{
  const segment={id:`s${i+1}`,start:offset,end:offset+text.length,text};offset=segment.end;return segment;
})};
const row=(id,text,extra={})=>({id,kind:'text',runs:[{text}],...extra});
function plan(rows,gestures=[],columns=1) {
  return {schemaVersion:2,sourceHash:source.sha256,pages:[{
    id:'page',title:'知识说明',layout:'notes',columns,segments:source.segments.map(s=>s.id),
    blocks:[{id:'block',title:'概念及其关系',segment:'s1',rows}],gestures,
  }]};
}
const compile=p=>compileLesson(source,p,metrics);

test('changing style or target boundaries does not change wrapping or character positions',()=>{
  const texts=['缓存目录 alpha-beta/entry，保留同一个词的边界。','先理解概念，再使用 API_v2 和示例核对。','第一行说明\n第二行再次说明。'];
  for(const text of texts)for(const width of [100,160,240]) {
    const options={x:73,y:91,width,size:20,metrics,hanging:20};
    const expected=cells(layoutRuns([{text}],options),20);
    for(let split=1;split<text.length;split++) {
      const actual=layoutRuns([{text:text.slice(0,split),id:'first',red:true},{text:text.slice(split),id:'second',segment:'later'}],options);
      assert.deepEqual(cells(actual,20),expected,`width=${width}, split=${split}, text=${text}`);
    }
  }
});

test('definition label and explanation share a line and label remains independently addressable',()=>{
  for(const label of ['术语','阶段名称','Cache']) {
    const lesson=compile(plan([{id:'definition',kind:'definition',label,runs:[{id:'meaning',text:'对应的解释',red:true}]}]));
    const targets=lesson.pages[0].targets,labelBox=targets['definition:label'],meaning=targets.meaning;
    assert.equal(labelBox.y,meaning.y);
    assert.equal(labelBox.w,measure(label,40,metrics));
    assert.equal(meaning.x,labelBox.x+labelBox.w+measure('：',40,metrics));
    assert.equal(targets.definition.rects.length,1);
    assert.equal(labelBox.red,false);assert.equal(meaning.red,true);
  }
});

test('wrapped inline target keeps one rectangle per occupied line',()=>{
  const lesson=compile(plan([row('explanation','概念解释与使用条件需要保持联系'.repeat(3),{
    runs:[{id:'long-phrase',text:'概念解释与使用条件需要保持联系'.repeat(3),red:true}],
  })],[],2));
  const target=lesson.pages[0].targets['long-phrase'];
  assert.ok(target.rects.length>=3);
  assert.equal(new Set(target.rects.map(r=>r.y)).size,target.rects.length);
  for(const rect of target.rects)assert.ok(rect.w<=403&&rect.h>0);
  assert.ok(target.h>target.rects[0].h);
});

test('multi-line circle leaves separate strokes and uninked travel between lines',()=>{
  const lesson=compile(plan([row('explanation','unused',{
    runs:[{id:'long-phrase',text:'这些条件需要完整保留并逐行强调'.repeat(3)}],
  })],[{id:'mark',intent:'emphasize',kind:'circle',target:'long-phrase',segment:'s2',duration:4,ink:true}],2));
  const page=lesson.pages[0],gesture=page.gestures[0],rects=page.targets['long-phrase'].rects;
  assert.equal(gesture.strokes.length,rects.length);
  assert.ok(gesture.strokes.length>1);
  for(const [i,stroke] of gesture.strokes.entries()) {
    const rect=rects[i];
    // Every ink stroke stays around its own text line. A connecting stroke
    // across two lines would violate these geometric limits.
    for(const [x,y] of stroke.points) {
      assert.ok(x>=rect.x-14.001&&x<=rect.x+rect.w+14.001);
      assert.ok(y>=rect.y-12.001&&y<=rect.y+rect.h+12.001);
    }
    if(i) {
      const previous=gesture.strokes[i-1];
      assert.ok(stroke.from>previous.to,'movement between lines needs a gap in ink intervals');
      const gap=(stroke.from+previous.to)/2;
      assert.equal(gesture.strokes.some(s=>gap>=s.from&&gap<=s.to),false);
    }
  }
  assert.ok(gesture.strokes.reduce((n,s)=>n+s.to-s.from,0)<1);
});

test('path combiner preserves disconnected ink when movement must cross a gap',()=>{
  const result=combinePaths([[[0,0],[10,0]],[[10,20],[20,20]]]);
  assert.deepEqual(result.strokes.map(s=>s.points),[[[0,0],[10,0]],[[10,20],[20,20]]]);
  assert.ok(result.strokes[0].to<result.strokes[1].from);
  assert.deepEqual(result.points,[[0,0],[10,0],[10,20],[20,20]]);
});

test('children retain indentation and cannot precede their parent',()=>{
  const rows=[row('parent','组成部分',{segment:'s1',children:[row('child','其中一个部分',{segment:'s2'})]})];
  const page=compile(plan(rows)).pages[0],parent=page.targets.parent,child=page.targets.child;
  assert.ok(child.x>parent.x);assert.ok(child.y>parent.y+parent.h);
  assert.ok(child.visibleFrom>=parent.visibleFrom);
  assert.ok(page.board.items.some(item=>item.kind==='path'&&item.id==='child:branch'));
  const early=structuredClone(rows);early[0].segment='s2';early[0].children[0].segment='s1';
  assert.throws(()=>compile(plan(early)),/Child row cannot appear before its parent/);
});

test('inline text may appear later without changing its predetermined position',()=>{
  const initial=[{id:'term',kind:'definition',label:'条件',runs:[{id:'value',text:'有明确的范围'}]}];
  const delayed=structuredClone(initial);delayed[0].runs[0].segment='s2';
  const a=compile(plan(initial)).pages[0].targets,b=compile(plan(delayed)).pages[0].targets;
  assert.deepEqual(a.value.rects,b.value.rects);
  assert.ok(b.value.visibleFrom>b['term:label'].visibleFrom);
  const invalid=structuredClone(initial);invalid[0].segment='s2';invalid[0].runs[0].segment='s1';
  assert.throws(()=>compile(plan(invalid)),/Inline run cannot appear before its row/);
});

test('duplicate run IDs are rejected within a row and across independent rows',()=>{
  const sameRow=plan([row('a','unused',{runs:[{id:'shared',text:'一部分'},{id:'shared',text:'另一部分'}]})]);
  assert.throws(()=>compile(sameRow),/duplicate run id/);
  const twoRows=plan([row('a','unused',{runs:[{id:'shared',text:'一部分'}]}),row('b','unused',{runs:[{id:'shared',text:'另一部分'}]})]);
  assert.throws(()=>compile(twoRows),/Duplicate target/);
});

test('overflow is rejected rather than hiding text or shrinking it indefinitely',()=>{
  assert.throws(()=>compile(plan([row('too-long','完整保留内容'.repeat(300))])),/overflows/);
  assert.throws(()=>layoutRuns([{text:'字'}],{x:0,y:0,width:10,size:40,metrics}),/Glyph cannot fit/);
});

test('intent, gesture type and ink must agree',()=>{
  const target=row('target','需要记住的条件');
  const base={id:'gesture',intent:'emphasize',kind:'circle',target:'target',segment:'s2',duration:2.6,ink:true};
  assert.equal(compile(plan([target],[base])).pages[0].gestures[0].ink,true);
  for(const change of [
    {intent:'guide'},
    {ink:false},
    {intent:'guide',ink:false},
    {intent:'relate',kind:'circle',ink:false},
  ])assert.throws(()=>compile(plan([target],[{...base,...change}])),/Guide gesture|Emphasis must|Relate needs/);
});

test('v2 semantic rows reject per-example pixel coordinates',()=>{
  assert.throws(()=>compile(plan([row('text','通用知识点',{x:120})])),/Unknown row field/);
});

test('automatic wrap keeps a trailing Han glyph with its preceding glyph across styles',()=>{
  const options={x:0,y:0,width:160,size:40,metrics};
  const plain=layoutRuns([{text:'直接选技能'}],options);
  const split=layoutRuns([{text:'直接选技',red:true},{text:'能'}],options);
  assert.deepEqual(cells(plain,40),cells(split,40));
  const final=plain.fragments.filter(f=>f.line===1).map(f=>f.text).join('');
  assert.equal(final,'技能');
  const explicit=layoutRuns([{text:'指定\n能'}],options);assert.equal(explicit.fragments.at(-1).text,'能');
});
