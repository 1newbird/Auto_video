import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlan} from '../scripts/lib/normalize-plan.mjs';
import {compileLesson} from '../scripts/lib/compile.mjs';
import {hash,segmentSource} from '../scripts/lib/text.mjs';
const text='先说明输入和准备过程。再执行步骤并核对结果。';
const source={schemaVersion:1,text,sha256:hash(text),segments:segmentSource(text)};
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const row=id=>({id,kind:'text',runs:[{text:id}]});
const base=()=>({schemaVersion:3,sourceHash:source.sha256,pages:[{id:'p',title:'结构',layout:'mixed',segments:source.segments.map(s=>s.id),elements:[
  {id:'compare',kind:'parallel',reason:'比较',groups:[{elements:[{id:'a',kind:'text',rows:[row('a1')]}]},{elements:[{id:'b',kind:'text',rows:[row('b1')]}]}]},
  {id:'flow',kind:'relation',nodes:[{id:'n1',title:'输入'},{id:'n2',title:'执行',segment:'s002'}],links:[{from:'n1',to:'n2',segment:'s001',label:'处理'}]},
]}]});
test('normalization handles observed group wrappers and early arrows without mutating the plan',()=>{
  const input=base(),before=structuredClone(input),{plan,repairs}=normalizePlan(input,source);
  assert.deepEqual(input,before);assert.equal(repairs.length,3);
  assert.deepEqual(normalizePlan(plan,source),{plan,repairs:[]});
  const lesson=compileLesson(source,plan,metrics),page=lesson.pages[0];
  const edge=page.board.items.find(i=>i.id==='flow:edge:0');
  assert.ok(edge.at*30>=page.targets.n2.visibleFrom);
  assert.equal(page.targets['flow:label:0'].visibleFrom,page.targets.n2.visibleFrom);
  assert.equal(lesson.captions.map(c=>c.text).join(''),text);
});
test('normalization does not discard unknown group data or invent missing targets',()=>{
  const input=base();input.pages[0].elements[0].groups[0].extra='preserve this';
  assert.throws(()=>normalizePlan(input,source),/pages\[0\].*groups\[0\].*nonempty elements array/);
  delete input.pages[0].elements[0].groups[0].extra;
  input.pages[0].elements[1].links[0].to='missing';
  const {plan}=normalizePlan(input,source);
  assert.throws(()=>compileLesson(source,plan,metrics),/pages\[0\].*elements\[1\].*Invalid relation/);
});

test('missing display symbols become supported text without changing IDs, quotes or source',()=>{
  const missing=new Set(['①','②','❸','→']);
  const font={...metrics,widths:new Proxy({},{get:(_,cp)=>missing.has(String.fromCodePoint(Number(cp)))?undefined:Number(cp)<128?500:1000})};
  const input=base();input.pages[0].title='① 组织 → 执行';
  input.pages[0].elements[1].nodes[0].title='② 输入';
  input.pages[0].elements[1].nodes[0].id='①-node';
  input.pages[0].elements[1].links[0].from='①-node';
  input.pages[0].elements[1].nodes[1].detail='❸ 结果';
  input.pages[0].gestures=[{quote:'① 原话 → 不替换',target:'①-node'}];
  const before=structuredClone(input),originalSource=structuredClone(source);
  const {plan,repairs}=normalizePlan(input,source,font);
  assert.deepEqual(input,before);assert.deepEqual(source,originalSource);
  assert.equal(plan.pages[0].title,'1. 组织 -> 执行');
  assert.equal(plan.pages[0].elements[1].nodes[0].title,'2. 输入');
  assert.equal(plan.pages[0].elements[1].nodes[1].detail,'3. 结果');
  assert.deepEqual(plan.pages[0].gestures,input.pages[0].gestures);
  assert.equal(plan.pages[0].elements[1].nodes[0].id,'①-node');
  assert.equal(repairs.filter(r=>r.kind==='font-symbol-fallback').length,3);
  assert.deepEqual(normalizePlan(plan,source,font),{plan,repairs:[]});
  plan.pages[0].gestures=[];
  const lesson=compileLesson(source,plan,font);
  assert.ok(lesson.pages[0].board.items.some(i=>i.text==='1. 组织 -> 执行'));
  assert.equal(lesson.captions.map(c=>c.text).join(''),source.text);
  assert.equal(normalizePlan(input,source,metrics).plan.pages[0].title,input.pages[0].title);
});

test('unknown missing glyphs across pages are reported together without silently removing content',()=>{
  const font={...metrics,widths:new Proxy({},{get:(_,cp)=>['☃','☂'].includes(String.fromCodePoint(Number(cp)))?undefined:1000})};
  const input=base();input.pages[0].title='☃';
  input.pages.push({...structuredClone(input.pages[0]),id:'second',title:'☂'});
  assert.throws(()=>normalizePlan(input,source,font),error=>{
    assert.equal(error.issues.length,2);
    assert.deepEqual(error.issues.map(i=>i.path),['pages[0].title','pages[1].title']);
    assert.match(error.message,/☃/);assert.match(error.message,/☂/);return true;
  });
  assert.equal(input.pages[0].title,'☃');assert.equal(input.pages[1].title,'☂');
});
