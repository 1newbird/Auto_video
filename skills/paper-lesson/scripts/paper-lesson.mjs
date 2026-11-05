#!/usr/bin/env node
// Fixed local tools. The host plans once; the user reviews the delivered video.
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateSource} from '../runtime/scripts/lib/compile.mjs';
import {resolveOutputDir,resolveVideoOptions} from './settings.mjs';
import {assertWithinOutput,storageEnvironment} from './storage.mjs';
import {checkAudio} from '../runtime/scripts/lib/audio.mjs';
import {ensureWordAlignment} from './alignment.mjs';
import {validateWordTimings} from '../runtime/scripts/lib/word-timing.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'runtime');
const args=process.argv.slice(2),command=args.shift();
const hash=value=>createHash('sha256').update(value).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value));
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const opt=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing ${name}`);return args[i+1];};
const required=name=>{const value=opt(name);if(!value)throw new Error(`Required ${name}`);return value;};
const venv=path.join(runtime,'.venv','Scripts','python.exe');
const python=process.env.PAPER_LESSON_PYTHON||(existsSync(venv)?venv:'python');
const env={...process.env,PAPER_LESSON_PYTHON:python,PYTHONUTF8:'1'};
let job,state,lock,outputRoot,video;
const commandStarted=performance.now();
let activeStep=command,lastStageAt=commandStarted;

async function writeJson(file,value) {
  const temp=`${file}.${process.pid}.tmp`;
  await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');
  await fs.rename(temp,file);
}
async function run(executable,parameters,{capture=false,cwd=runtime,childEnv=env}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,parameters,{cwd,env:childEnv,windowsHide:true,shell:false,stdio:['ignore',capture?'pipe':'inherit','pipe']});
    let stdout='',stderr='';
    if(capture)child.stdout.on('data',b=>stdout+=b);
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-65536);if(!capture)process.stderr.write(b);});
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(stdout):reject(new Error(`${path.basename(executable)} exited ${code}${stderr?`: ${stderr.trim()}`:''}`)));
  });
}
const engine=(script,parameters)=>run(process.execPath,[path.join(runtime,'scripts',script),...parameters],{cwd:job??runtime});

async function fingerprint() {
  const entries=[];
  async function walk(dir) {
    for(const item of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;
      const file=path.join(dir,item.name);
      if(item.isDirectory())await walk(file);
      else entries.push([path.relative(runtime,file).replaceAll('\\','/'),hash(await fs.readFile(file))]);
    }
  }
  for(const dir of ['src','scripts','public'])await walk(path.join(runtime,dir));
  for(const name of ['package-lock.json','requirements.txt','tsconfig.json'])entries.push([name,hash(await fs.readFile(path.join(runtime,name)))]);
  return jsonHash(entries);
}
async function doctor() {
  const checks=[];
  async function check(name,fn) {try {const detail=await fn();checks.push({name,passed:true,detail});}catch(error){checks.push({name,passed:false,detail:error.message});}}
  await check('platform',()=>{if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Current package supports Windows x64');return `${process.platform}/${process.arch}`;});
  await check('node',()=>{if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ required');return process.versions.node;});
  await check('python',async()=>JSON.parse(await run(python,['-c','import sys,json; assert sys.version_info >= (3,12), "Python 3.12+ required"; import fontTools,PIL,numpy; print(json.dumps({"executable":sys.executable,"version":sys.version.split()[0]}))'],{capture:true})));
  await check('node_dependencies',async()=>{await run(process.execPath,['--input-type=module','-e',"import '@remotion/bundler'; import '@remotion/renderer'; import 'react'; import 'roughjs';"],{capture:true});return 'installed';});
  await check('font',async()=>{const stat=await fs.stat(path.join(runtime,'public/fonts/ChillZhuo.ttf'));if(stat.size<1000)throw new Error('Bundled font missing');return stat.size;});
  await check('browser',async()=>{const browser=path.join(runtime,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');await fs.access(browser);return browser;});
  const result={passed:checks.every(c=>c.passed),root,checks};console.log(JSON.stringify(result,null,2));
  if(!result.passed)process.exitCode=1;
}
async function setup() {
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Current package supports Windows x64');
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ required');
  const npmCli=process.env.PAPER_LESSON_NPM_CLI||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!existsSync(npmCli))throw new Error('npm CLI not found alongside node; set PAPER_LESSON_NPM_CLI to npm-cli.js');
  await run(process.env.PAPER_LESSON_PYTHON||'python',['-c','import sys; assert sys.version_info >= (3,12), "Python 3.12+ required"']);
  await run(process.execPath,[npmCli,'ci','--no-audit','--no-fund']);
  if(!existsSync(venv))await run(process.env.PAPER_LESSON_PYTHON||'python',['-m','venv',path.dirname(path.dirname(venv))]);
  await run(venv,['-m','pip','install','--disable-pip-version-check','-r',path.join(runtime,'requirements.txt')]);
  await run(process.execPath,['--input-type=module','-e',"import {ensureBrowser} from '@remotion/renderer'; await ensureBrowser();"]);
  console.log('Setup complete. Run doctor to verify this installation.');
}
async function inputs() {
  const source=await readJson(path.join(job,'source.json'));validateSource(source);
  if(source.audio){await assertWithinOutput(job,source.audio.path);await checkAudio(source.audio);}
  const plan=await readJson(path.join(job,'plan.json'));
  if(plan.sourceHash!==source.sha256)throw new Error('Plan sourceHash does not match this job source');
  let wordTimingsHash=null;
  if(source.audio)wordTimingsHash=jsonHash(validateWordTimings(source,await readJson(path.join(job,'word-timings.json'))));
  return {sourceHash:source.sha256,sourceFileHash:jsonHash(source),planHash:jsonHash(plan),engineHash:await fingerprint(),videoSettingsHash:jsonHash(video),...(source.audio?{wordTimingsHash}:{})};
}
async function currentCompilation() {
  const current=await inputs();
  if(!state.compiled||Object.entries(current).some(([k,v])=>state.compiled[k]!==v))throw new Error('Inputs or renderer changed (including video settings). Run build or compile before rendering.');
  const lesson=await readJson(path.join(job,'output/lesson.json'));
  if(jsonHash(lesson)!==state.compiled.lessonHash)throw new Error('Compiled output changed. Run compile again.');
  return current;
}
async function currentReview(current) {
  if(state.reviewPolicy==='user')return; // User reviews the delivered video, never a render gate.
  if(state.reviewPolicy==='quick') {
    await currentPreview(current);
    if(!state.inspection||state.inspection.lessonHash!==state.compiled.lessonHash||state.inspection.engineHash!==current.engineHash)throw new Error('Inspect the current preview, then record it with inspect --summary');
    return state.inspection;
  }
  const review=await readJson(path.join(job,'review.json'));
  if(review.schemaVersion!==1||review.passed!==true||review.sourceHash!==current.sourceHash||review.planHash!==current.planHash||review.engineHash!==current.engineHash||review.lessonHash!==state.compiled.lessonHash||!Array.isArray(review.issues)||review.issues.length||typeof review.summary!=='string'||!review.summary.trim()||typeof review.reviewer!=='string'||!review.reviewer.trim())throw new Error('A passing review of the current source, plan, renderer and compiled lesson is required; follow references/roles/reviewer.md');
  if(!state.preview||state.preview.lessonHash!==state.compiled.lessonHash||state.preview.engineHash!==current.engineHash)throw new Error('Preview this compilation before visual review/render');
  return review;
}
async function currentPreview(current) {
  if(!state.preview||state.preview.lessonHash!==state.compiled.lessonHash||state.preview.engineHash!==current.engineHash)throw new Error('Preview this compilation before inspection/render');
  const manifest=await readJson(path.join(job,'output/preview-manifest.json'));
  if(manifest.lessonHash!==state.compiled.lessonHash)throw new Error('Preview manifest is stale');
  for(const file of state.preview.files??[])if(hash(await fs.readFile(path.join(job,'output',file.name)))!==file.hash)throw new Error('Preview image changed. Run preview again.');
}
async function persist(stage) {
  state.stage=stage;state.updatedAt=new Date().toISOString();state.lastCommand=command;
  state.commandHistory??=[];
  const now=performance.now();
  state.commandHistory.push({command,stage,seconds:Number(((now-lastStageAt)/1000).toFixed(3)),at:state.updatedAt});
  lastStageAt=now;
  await writeJson(path.join(job,'task.json'),state);
}
async function compileTask({reuse=false}={}) {
  activeStep='align';
  const wordFile=await ensureWordAlignment({job,outputRoot,python});
  activeStep='compile';
  state.reviewPolicy=opt('--review-policy','user');
  if(!['user','quick','independent'].includes(state.reviewPolicy))throw new Error('review-policy must be user, quick or independent');
  state.outputRoot=outputRoot;
  state.video=video;
  if(reuse) {
    try {await currentCompilation();console.log('Reusing current checked compilation.');return;}catch { /* Compile changed inputs below. */ }
  }
  delete state.compiled;delete state.preview;delete state.inspection;delete state.rendered;delete state.verified;
  const out=path.join(job,'output');
  let startedEngine=false;
  try {
    const current=await inputs();
    startedEngine=true;
    await engine('lesson.mjs',['compile','--source',path.join(job,'source.json'),'--plan',path.join(job,'plan.json'),'--out',out,'--quality',video.quality,'--fps',String(video.fps),...(wordFile?['--word-timings',wordFile]:[])]);
    state.compiled={...current,lessonHash:jsonHash(await readJson(path.join(out,'lesson.json')))};
    await persist('compiled');
  } catch(error) {
    if(!startedEngine) {
      await fs.mkdir(out,{recursive:true});
      await writeJson(path.join(out,'compile-report.json'),{passed:false,error:error.message,repairs:[]});
    }
    throw error;
  }
}
async function renderTask() {
  activeStep='render';
  const out=path.join(job,'output'),current=await currentCompilation();await currentReview(current);
  delete state.rendered;delete state.verified;
  await engine('render-lesson.mjs',['--lesson',path.join(out,'lesson.json'),'--out-dir',out,'--video-only',...(opt('--strategy')?['--strategy',opt('--strategy')]:[])]);
  state.rendered={...state.compiled,videoHash:hash(await fs.readFile(path.join(out,'lesson.mp4')))};
  await persist('rendered');
}
async function verifyTask() {
  activeStep='verify';
  const out=path.join(job,'output'),current=await currentCompilation();await currentReview(current);
  if(!state.rendered||state.rendered.lessonHash!==state.compiled.lessonHash||state.rendered.engineHash!==current.engineHash)throw new Error('Render the current compilation first');
  if(hash(await fs.readFile(path.join(out,'lesson.mp4')))!==state.rendered.videoHash)throw new Error('Rendered video changed; render it again');
  await engine('verify-lesson.mjs',[out,...(args.includes('--regression')?['--regression']:[])]);
  state.verified={...state.rendered,mode:args.includes('--regression')?'regression':'daily',checkedAt:new Date().toISOString()};
  await persist('verified');
}

try {
  const known=['doctor','setup','prepare','align','check','build','compile','preview','inspect','render','verify','status'];
  if(!known.includes(command)) {
    console.log('paper-lesson: prepare --script file [--audio file --subtitles file.srt --subtitle-level auto|cue|word] [--job dir] [--output-dir root] | align --job dir [--words word-timings.json | --refresh] | check|build|compile|render|verify|status --job dir. *.word.srt imports word times directly. User review by default; no LLM calls.');
    if(command&&command!=='--help')process.exitCode=1;
  } else if(command==='doctor')await doctor();
  else if(command==='setup')await setup();
  else {
    outputRoot=await resolveOutputDir(opt('--output-dir'));
    video=await resolveVideoOptions({quality:opt('--quality'),fps:opt('--fps')===undefined?undefined:Number(opt('--fps'))});
    job=command==='prepare'&&opt('--job')===undefined
      ?path.join(outputRoot,`j-${Date.now().toString(36)}`)
      :path.resolve(required('--job'));
    await assertWithinOutput(outputRoot,job);
    const rel=path.relative(root,job);
    if(rel===''||(rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)))throw new Error('Keep job outputs outside the installed Skill directory');
    if(command==='status') {
      state=await readJson(path.join(job,'task.json'));
      let current=false,reason='not compiled';
      if(state.compiled)try {await currentCompilation();current=true;reason=null;}catch(error){reason=error.message;}
      console.log(JSON.stringify({...state,compilationCurrent:current,staleReason:reason},null,2));
    } else {
      if(command==='prepare')await fs.mkdir(job,{recursive:true});
      lock=await fs.open(path.join(job,'.running'),'wx').catch(()=>{throw new Error('Job is busy or missing. Use prepare for a new job; do not run two commands on the same job.');});
      await lock.writeFile(JSON.stringify({pid:process.pid,command,startedAt:new Date().toISOString()}));
      Object.assign(env,await storageEnvironment(job),{PAPER_LESSON_OUTPUT_ROOT:outputRoot});
      if(command==='prepare') {
        if(existsSync(path.join(job,'source.json'))||existsSync(path.join(job,'task.json')))throw new Error('Job already exists; use a new directory to preserve previous work');
        const script=path.resolve(required('--script'));
        const reviewPolicy=opt('--review-policy','user');
        if(!['user','quick','independent'].includes(reviewPolicy))throw new Error('review-policy must be user, quick or independent');
        const parameters=['prepare','--script',script,'--out',job];
        for(const flag of ['--start','--end-before','--audio','--subtitles','--subtitle-level'])if(opt(flag)!==undefined)parameters.push(flag,opt(flag));
        await engine('lesson.mjs',parameters);
        await fs.copyFile(script,path.join(job,'original-script.txt'));
        const source=await readJson(path.join(job,'source.json'));
        state={schemaVersion:1,kind:'paper-lesson-job',input:script,reviewPolicy,outputRoot,createdAt:new Date().toISOString(),timingMode:source.timingMode??'estimated',output:'output',stage:'prepared'};
        await persist('prepared');
      } else {
        state=await readJson(path.join(job,'task.json'));
        const out=path.join(job,'output');
        if(command==='align') {
          activeStep='align';
          await ensureWordAlignment({job,outputRoot,python,importFile:opt('--words'),refresh:args.includes('--refresh')});
          await persist('aligned');
        } else if(command==='compile'||command==='check') {
          await compileTask();
        } else if(command==='build') {
          await compileTask({reuse:true});
          await renderTask();
          await verifyTask();
        } else if(command==='preview') {
          const current=await currentCompilation();
          await engine('render-lesson.mjs',['--lesson',path.join(out,'lesson.json'),'--out-dir',out,'--preview']);
          const files=(await fs.readdir(out)).filter(f=>/^page-\d+\.png$/.test(f));
          state.preview={lessonHash:state.compiled.lessonHash,engineHash:current.engineHash,files:await Promise.all(files.map(async name=>({name,hash:hash(await fs.readFile(path.join(out,name)))})))};
          delete state.inspection;
          await persist('previewed');
        } else if(command==='inspect') {
          const current=await currentCompilation();await currentPreview(current);
          const summary=required('--summary').trim();if(!summary)throw new Error('Inspection summary cannot be blank');
          state.inspection={...state.compiled,summary,checkedAt:new Date().toISOString(),kind:'self-inspection'};
          await persist('inspected');
        } else if(command==='render') {
          await renderTask();
        } else if(command==='verify') {
          await verifyTask();
        }
      }
      if(state){delete state.error;await writeJson(path.join(job,'task.json'),state);console.log(`Job ${state.stage}: ${job}`);}
    }
  }
} catch(error) {
  console.error(error.message);process.exitCode=1;
  if(state&&lock){state.error={command,step:activeStep,message:error.message,at:new Date().toISOString()};await writeJson(path.join(job,'task.json'),state).catch(()=>{});}
} finally {
  if(lock){await lock.close();await fs.unlink(path.join(job,'.running')).catch(()=>{});}
}
