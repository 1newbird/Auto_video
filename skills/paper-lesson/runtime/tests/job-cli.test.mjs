import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const cli=fileURLToPath(new URL('../../scripts/paper-lesson.mjs',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value));
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const writeJson=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2));

async function fixture(t,reviewPolicy='user') {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'paper-lesson-cli-'));
  t.after(async()=>{
    // Only remove this test's directly created, isolated temporary directory.
    assert.equal(path.dirname(base),path.resolve(os.tmpdir()));
    assert.ok(path.basename(base).startsWith('paper-lesson-cli-'));
    await fs.rm(base,{recursive:true,force:true});
  });
  const script=path.join(base,'原稿 示例.txt'),job=path.join(base,'独立 任务');
  const run=(command,...args)=>spawnSync(process.execPath,[cli,command,'--job',job,'--output-dir',base,...(command==='compile'&&reviewPolicy!=='user'?['--review-policy',reviewPolicy]:[]),...args],{
    cwd:base,encoding:'utf8',windowsHide:true,timeout:30000,
    env:{...process.env,PYTHONUTF8:'1'},
  });
  const ok=(command,...args)=>{
    const result=run(command,...args);
    assert.equal(result.status,0,result.stderr||String(result.error));
    return result.stdout;
  };
  const fails=(command,pattern,...args)=>{
    const result=run(command,...args);
    assert.equal(result.status,1,result.stderr||String(result.error));
    assert.match(result.stderr,pattern);
    return result;
  };
  const file=name=>path.join(job,name);
  await fs.writeFile(script,'先确定目标，再安排步骤。最后核对结果。');
  ok('prepare','--script',script,'--review-policy',reviewPolicy);
  const source=await readJson(file('source.json'));
  const plan={schemaVersion:2,sourceHash:source.sha256,pages:[{
    id:'page-1',title:'安排任务',layout:'notes',columns:1,
    segments:source.segments.map(s=>s.id),
    blocks:[{id:'block-1',title:'明确顺序',segment:source.segments[0].id,rows:[
      {id:'row-1',kind:'text',runs:[{text:'先确定目标，再安排步骤。'}]},
      {id:'row-2',kind:'text',segment:source.segments[1].id,runs:[{text:'最后核对结果。'}]},
    ]}],
  }]};
  return {base,job,script,source,plan,file,run,ok,fails,
    async compile(){await writeJson(file('plan.json'),plan);ok('compile');return readJson(file('task.json'));},
    status(){return JSON.parse(ok('status'));},
  };
}

test('prepare records a resumable task and refuses to overwrite an existing job',async t=>{
  const f=await fixture(t),before=await fs.readFile(f.file('source.json'),'utf8');
  const state=await readJson(f.file('task.json'));
  assert.equal(state.stage,'prepared');assert.equal(state.kind,'paper-lesson-job');
  assert.equal(state.timingMode,'estimated');assert.equal(state.input,f.script);
  assert.equal(await fs.readFile(f.file('script.txt'),'utf8'),f.source.text);
  assert.equal(f.status().compilationCurrent,false);
  f.fails('prepare',/already exists/,'--script',f.script);
  assert.equal(await fs.readFile(f.file('source.json'),'utf8'),before);
  assert.deepEqual(await readJson(f.file('task.json')),state);
  f.fails('compile',/plan\.json/);
  const failed=await readJson(f.file('task.json'));
  assert.equal(failed.stage,'prepared');assert.equal(failed.error.command,'compile');
  await assert.rejects(fs.access(f.file('.running')),/ENOENT/);
});

test('compile persists current hashes and invalidates downstream task stages',async t=>{
  const f=await fixture(t),state=await f.compile();
  const lesson=await readJson(f.file('output/lesson.json'));
  assert.equal(state.stage,'compiled');assert.equal(state.lastCommand,'compile');
  assert.equal(state.compiled.sourceHash,f.source.sha256);
  assert.equal(state.compiled.sourceFileHash,jsonHash(f.source));
  assert.equal(state.compiled.planHash,jsonHash(f.plan));
  assert.equal(state.compiled.lessonHash,jsonHash(lesson));
  assert.match(state.compiled.engineHash,/^[a-f0-9]{64}$/);
  assert.equal(lesson.captions.map(c=>c.text).join(''),f.source.text);
  assert.equal(f.status().compilationCurrent,true);
  // Simulated state only: this suite never previews, renders, or verifies video.
  await writeJson(f.file('task.json'),{...state,stage:'verified',
    preview:{lessonHash:state.compiled.lessonHash,engineHash:state.compiled.engineHash},
    rendered:{...state.compiled},verified:{...state.compiled},error:{message:'old error'}});
  f.ok('compile');
  const recompiled=await readJson(f.file('task.json'));
  assert.equal(recompiled.stage,'compiled');
  for(const key of ['preview','rendered','verified','error'])assert.equal(recompiled[key],undefined);
});

test('changed plan, source text, or compiled lesson cannot reuse previous output',async t=>{
  const f=await fixture(t);await f.compile();
  f.plan.pages[0].title='新的任务安排';await writeJson(f.file('plan.json'),f.plan);
  assert.equal(f.status().compilationCurrent,false);
  f.fails('verify',/Inputs or renderer changed/);
  f.ok('compile');assert.equal(f.status().compilationCurrent,true);
  const lesson=await readJson(f.file('output/lesson.json'));
  lesson.pages[0].title='外部编辑';await writeJson(f.file('output/lesson.json'),lesson);
  assert.equal(f.status().compilationCurrent,false);
  f.fails('verify',/Compiled output changed/);
  f.ok('compile');
  const source=structuredClone(f.source);source.text=source.text.replace('目标','目的');
  await writeJson(f.file('source.json'),source);
  assert.equal(f.status().compilationCurrent,false);
  f.fails('verify',/Source text\/hash mismatch/);
  source.sha256=hash(source.text);
  for(const segment of source.segments)segment.text=source.text.slice(segment.start,segment.end);
  await writeJson(f.file('source.json'),source);
  f.fails('compile',/Plan sourceHash does not match/);
});

test('valid source segmentation changes invalidate a previous compilation',async t=>{
  const f=await fixture(t);await f.compile();
  const source=structuredClone(f.source);
  source.segments[0].end--;
  source.segments[1].start=source.segments[0].end;
  for(const segment of source.segments)segment.text=source.text.slice(segment.start,segment.end);
  await writeJson(f.file('source.json'),source);
  assert.equal(source.segments.map(s=>s.text).join(''),source.text);
  assert.equal(f.status().compilationCurrent,false,'Changed segment timing must invalidate the compiled output');
  f.fails('verify',/Inputs or renderer changed/);
});

test('review must pass for current inputs and follow a matching preview',async t=>{
  const f=await fixture(t,'independent'),state=await f.compile();
  f.fails('verify',/review\.json/);
  const review={schemaVersion:1,sourceHash:state.compiled.sourceHash,
    planHash:state.compiled.planHash,engineHash:state.compiled.engineHash,
    lessonHash:state.compiled.lessonHash,
    passed:true,issues:[],summary:'Synthetic review for CLI gate tests only.',reviewer:'test-fixture'};
  for(const change of [
    {schemaVersion:2},{passed:false},{sourceHash:'stale'},{planHash:'stale'},
    {engineHash:'stale'},{engineHash:undefined},{lessonHash:'stale'},
    {lessonHash:undefined},{issues:[{problem:'unresolved'}]},
    {summary:' '},{reviewer:''},
  ]) {
    await writeJson(f.file('review.json'),{...review,...change});
    f.fails('verify',/passing review/);
  }
  await writeJson(f.file('review.json'),review);
  f.fails('verify',/Preview this compilation/);
  const preview={lessonHash:state.compiled.lessonHash,engineHash:state.compiled.engineHash};
  await writeJson(f.file('task.json'),{...state,stage:'previewed',preview:{...preview,lessonHash:'stale'}});
  f.fails('verify',/Preview this compilation/);
  await writeJson(f.file('task.json'),{...state,stage:'previewed',preview:{...preview,engineHash:'stale'}});
  f.fails('verify',/Preview this compilation/);
  await writeJson(f.file('task.json'),{...state,stage:'previewed',preview});
  f.fails('verify',/Render the current compilation first/);
  assert.equal((await readJson(f.file('task.json'))).stage,'previewed');
  f.plan.pages[0].title='更新任务';await writeJson(f.file('plan.json'),f.plan);f.ok('compile');
  f.fails('verify',/passing review/);
  await assert.rejects(fs.access(f.file('output/lesson.mp4')),/ENOENT/);
});

test('quick workflow keeps current preview and inspection gates without independent review',async t=>{
  const f=await fixture(t,'quick'),state=await f.compile();
  assert.equal(state.reviewPolicy,'quick');
  assert.ok(state.commandHistory.some(h=>h.command==='compile'&&h.seconds>=0));
  f.fails('render',/Preview this compilation/);
  // Synthetic gate fixture only; no actual preview/render is claimed.
  await writeJson(f.file('task.json'),{...state,preview:{lessonHash:state.compiled.lessonHash,engineHash:state.compiled.engineHash}});
  await writeJson(f.file('output/preview-manifest.json'),{lessonHash:state.compiled.lessonHash});
  f.fails('render',/Inspect the current preview/);
  f.ok('inspect','--summary','Synthetic inspection for CLI gates only.');
  assert.equal((await readJson(f.file('task.json'))).stage,'inspected');
  f.fails('verify',/Render the current compilation first/);
  f.ok('compile');assert.equal((await readJson(f.file('task.json'))).inspection,undefined);
});

test('default user workflow does not require preview, inspect or review reports',async t=>{
  const f=await fixture(t),state=await f.compile();
  assert.equal(state.reviewPolicy,'user');
  f.fails('verify',/Render the current compilation first/);
  for(const file of ['review.json','output/preview-manifest.json'])await assert.rejects(fs.access(f.file(file)),/ENOENT/);
  const old={...state,reviewPolicy:'quick'};await writeJson(f.file('task.json'),old);
  f.ok('compile');assert.equal((await readJson(f.file('task.json'))).reviewPolicy,'user');
});

test('prepare refuses a job outside the configured output root before writing there',async t=>{
  const f=await fixture(t);
  const other=path.join(f.base,'configured');
  const result=spawnSync(process.execPath,[cli,'prepare','--script',f.script,'--job',path.join(f.base,'outside'),'--output-dir',other],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.match(result.stderr,/inside configured output directory/);
  await assert.rejects(fs.access(path.join(f.base,'outside')),/ENOENT/);
});

test('check normalizes known format errors without overwriting the plan or producing video',async t=>{
  const f=await fixture(t);
  const plan={schemaVersion:3,sourceHash:f.source.sha256,pages:[{
    id:'p',title:'比较',layout:'mixed',segments:f.source.segments.map(s=>s.id),elements:[
      {id:'compare',kind:'parallel',reason:'比较两种方式',groups:[
        {elements:[{id:'left',kind:'text',rows:[{id:'l',kind:'text',runs:[{text:'方式一'}]}]}]},
        {elements:[{id:'right',kind:'text',rows:[{id:'r',kind:'text',runs:[{text:'方式二'}]}]}]},
      ]}
    ]
  }]};
  await writeJson(f.file('plan.json'),plan);f.ok('check');
  assert.deepEqual(await readJson(f.file('plan.json')),plan);
  const report=await readJson(f.file('output/compile-report.json'));
  assert.equal(report.passed,true);assert.equal(report.repairs.length,2);
  assert.equal(f.status().compilationCurrent,true);
  await assert.rejects(fs.access(f.file('output/lesson.mp4')),/ENOENT/);
  plan.pages[0].elements[0].groups[0].extra='must not drop';
  await writeJson(f.file('plan.json'),plan);
  f.fails('check',/pages\[0\].*groups\[0\]/);
  const failed=await readJson(f.file('output/compile-report.json'));
  assert.equal(failed.passed,false);assert.match(failed.error,/groups\[0\]/);
  const state=await readJson(f.file('task.json'));
  assert.equal(state.error.step,'compile');assert.match(state.error.message,/groups\[0\]/);
  assert.equal(state.compiled,undefined);
});

test('build reports a failed check and stops before rendering',async t=>{
  const f=await fixture(t);await f.compile();
  f.plan.pages[0].blocks[0].rows[0].runs=[];
  await writeJson(f.file('plan.json'),f.plan);
  f.fails('build',/pages\[0\]/);
  assert.equal((await readJson(f.file('output/compile-report.json'))).passed,false);
  await assert.rejects(fs.access(f.file('output/render-manifest.json')),/ENOENT/);
});

test('quality/fps changes invalidate compilation and reuse the original semantic plan',async t=>{
  const f=await fixture(t);await writeJson(f.file('plan.json'),f.plan);
  f.ok('check');
  let lesson=await readJson(f.file('output/lesson.json'));
  assert.equal(lesson.width,2160);assert.equal(lesson.height,3840);assert.equal(lesson.fps,30);
  assert.equal(JSON.parse(f.ok('status','--quality','1080p')).compilationCurrent,false);
  f.fails('render',/video settings/,'--fps','60');
  f.ok('check','--quality','1440p','--fps','60');
  lesson=await readJson(f.file('output/lesson.json'));
  assert.equal(lesson.width,1440);assert.equal(lesson.height,2560);assert.equal(lesson.fps,60);
  assert.deepEqual(await readJson(f.file('plan.json')),f.plan);
  assert.equal(JSON.parse(f.ok('status','--quality','1440p','--fps','60')).compilationCurrent,true);
});
