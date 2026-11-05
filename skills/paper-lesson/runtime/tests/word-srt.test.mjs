import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseSrt,timedText} from '../scripts/lib/audio.mjs';
import {groupWordCues,wordTimingsFromGroups} from '../scripts/lib/word-srt.mjs';
import {quoteTiming} from '../scripts/lib/word-timing.mjs';
import {hash} from '../scripts/lib/text.mjs';
import {ensureWordAlignment} from '../../scripts/alignment.mjs';
const srt='1\n00:00:00,100 --> 00:00:00,300\n看\n\n2\n00:00:00,300 --> 00:00:00,400\nS\n\n3\n00:00:00,400 --> 00:00:00,800\nKILL\n\n4\n00:00:00,800 --> 00:00:00,900\n.\n\n5\n00:00:00,900 --> 00:00:01,200\nmd\n\n6\n00:00:01,200 --> 00:00:01,250\n。\n\n7\n00:00:01,250 --> 00:00:02,000\n(breath)\n\n8\n00:00:02,100 --> 00:00:02,500\n完成\n\n9\n00:00:02,500 --> 00:00:02,600\n。\n';
const groups=groupWordCues(parseSrt(srt));
const timed=timedText(groups.map(({words,...cue})=>cue),3);
const source={schemaVersion:1,...timed,sha256:hash(timed.text),timingMode:'subtitles',audio:{path:'unused',sha256:'test',duration:3}};

test('word SRT groups sentences, joins English pieces and keeps supplied times and pauses',()=>{
  assert.equal(timed.text,'看SKILL.md。\n完成。');
  assert.deepEqual(source.segments.map(s=>[s.startSeconds,s.endSeconds]),[[.1,1.25],[2.1,2.6]]);
  const data=wordTimingsFromGroups(source,groups);
  assert.equal(data.method,'provided-word-srt');
  assert.deepEqual(quoteTiming(source.segments[0],'SKILL.md',data),{startSeconds:.3,endSeconds:1.2,precision:'word'});
  assert.equal(data.segments.s001.length,6);
  assert.deepEqual(data.segments.s001.map(w=>[w.startSeconds,w.endSeconds]),parseSrt(srt).slice(0,6).map(c=>[c.startSeconds,c.endSeconds]));
  assert.throws(()=>wordTimingsFromGroups({...source,segments:[{...source.segments[0],text:'different'},source.segments[1]]},groups),/differs/);
});

test('standalone known stage directions are skipped without hiding invalid intervals or unknown text',()=>{
  assert.equal(parseSrt(srt).length,8);
  assert.throws(()=>parseSrt(srt.replace('00:00:01,250 --> 00:00:02,000','00:00:01,100 --> 00:00:02,000')),/overlapping/);
  assert.throws(()=>parseSrt('1\n00:00:00,000 --> 00:00:01,000\n(breath)'),/no spoken text/);
  assert.throws(()=>parseSrt('1\n00:00:00,000 --> 00:00:01,000\n'),/empty text/);
  assert.equal(parseSrt(srt.replace('(breath)','(example)'))[6].text,'(example)');
});

test('grouping handles closing quotes, long pauses and UTF-16 indices without fabricating timing',()=>{
  const cues=['你','好','。','”','再','见','😀'].map((text,i)=>({text,startSeconds:i*.2+(i>=4?1:0),endSeconds:i*.2+.1+(i>=4?1:0)}));
  const g=groupWordCues(cues);
  assert.deepEqual(g.map(s=>s.text),['你好。”','再见😀']);
  assert.equal(g[1].words.at(-1).end-g[1].words.at(-1).start,2);
  assert.equal(g[1].startSeconds,cues[4].startSeconds);
});

test('word SRT regenerated/cached/refresh paths never invoke a Python or acoustic model',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'word-srt-test-'));
  t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('word-srt-test-'));await fs.rm(dir,{recursive:true,force:true});});
  const job=path.join(dir,'job');await fs.mkdir(job);
  const audio=path.join(job,'narration.bin'),subtitles=path.join(job,'original-subtitles.srt');
  await fs.writeFile(audio,'test-audio');await fs.writeFile(subtitles,srt);
  const s={...source,audio:{...source.audio,path:audio,sha256:hash('test-audio')},subtitles:{path:subtitles,sha256:hash(srt),precision:'word'}};
  await fs.writeFile(path.join(job,'source.json'),JSON.stringify(s));
  const args={job,outputRoot:dir,python:'must-not-run'};
  const file=await ensureWordAlignment(args);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),wordTimingsFromGroups(s,groups));
  assert.equal(await ensureWordAlignment(args),file);
  assert.equal(await ensureWordAlignment({...args,refresh:true}),file);
  await assert.rejects(fs.access(path.join(dir,'.paper-lesson-align')));
  await fs.writeFile(subtitles,srt.replace('KILL','changed'));
  await assert.rejects(ensureWordAlignment({...args,refresh:true}),/SRT changed/);
});
