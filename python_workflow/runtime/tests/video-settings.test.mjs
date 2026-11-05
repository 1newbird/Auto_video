import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileLesson,makeSrt} from '../scripts/lib/compile.mjs';
import {validateLesson} from '../scripts/lib/validate-lesson.mjs';
import {hash,segmentSource} from '../scripts/lib/text.mjs';
import {renderTimeline} from '../scripts/lib/render-timeline.mjs';

const text=fs.readFileSync(new URL('../../tests/fixtures/quality-history/source.md',import.meta.url),'utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
const source={schemaVersion:1,text,sha256:hash(text),segments:segmentSource(text)};
const plan=JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/quality-history/plan.json',import.meta.url),'utf8'));
const metrics={unitsPerEm:1000,widths:new Proxy({},{get:(_,cp)=>Number(cp)<128?500:1000})};
const baseline=compileLesson(source,plan,metrics);
test('caption visibility changes only rendered overlay, preserving SRT/board/gestures and clip coverage',()=>{
  const hidden=compileLesson(source,plan,metrics,{showCaptions:false});
  assert.ok(validateLesson(hidden));
  assert.equal(makeSrt(hidden),makeSrt(baseline));
  assert.deepEqual(hidden.pages,baseline.pages);
  assert.deepEqual(hidden.segmentTimings,baseline.segmentTimings);
  for(const range of [undefined,[20,50]]) {
    const visibleTimeline=renderTimeline(baseline,range),hiddenTimeline=renderTimeline(hidden,range);
    assert.deepEqual(hiddenTimeline.board,visibleTimeline.board);
    assert.equal(hiddenTimeline.captions.length,1);
    assert.deepEqual(hiddenTimeline.captions[0].lines,[]);
    assert.equal(hiddenTimeline.captions[0].end-hiddenTimeline.captions[0].start,hiddenTimeline.end-hiddenTimeline.start);
  }
  const legacy=structuredClone(baseline);delete legacy.showCaptions;
  assert.deepEqual(renderTimeline(legacy),renderTimeline(baseline));
  assert.throws(()=>compileLesson(source,plan,metrics,{showCaptions:'false'}),/boolean/);
});
for(const [width,height] of [[1080,1920],[1440,2560],[2160,3840]])for(const fps of [30,60]) {
  test(`${width}x${height}/${fps}: content and seconds unchanged, pen phases match output fps`,()=>{
    const lesson=compileLesson(source,plan,metrics,{width,height,fps});
    assert.ok(validateLesson(lesson));
    assert.equal(lesson.width,width);assert.equal(lesson.height,height);assert.equal(lesson.fps,fps);
    assert.equal(lesson.duration,baseline.duration);
    assert.equal(lesson.durationFrames,baseline.durationFrames*fps/30);
    assert.equal(makeSrt(lesson),makeSrt(baseline));
    for(let p=0;p<lesson.pages.length;p++) {
      const page=lesson.pages[p],old=baseline.pages[p];
      assert.deepEqual(page.board.items,old.board.items);
      assert.equal(page.board.width,width);assert.equal(page.board.height,height);
      for(let i=0;i<page.gestures.length;i++)for(const key of ['startFrame','endFrame','activeStart','activeEnd'])
        assert.equal(page.gestures[i][key]/fps,old.gestures[i][key]/30);
    }
    const timeline=renderTimeline(lesson);
    assert.equal(timeline.board.reduce((n,s)=>n+s.end-s.start,0),lesson.durationFrames);
    assert.equal(timeline.board.filter(s=>s.dynamic).reduce((n,s)=>n+s.end-s.start,0),54*fps/30);
  });
}
