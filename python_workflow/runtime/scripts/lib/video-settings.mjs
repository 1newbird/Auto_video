// Layout coordinates stay at 1080×1920. SVG rasterization uses output dimensions.
export function configureVideo(lesson,{width=1080,height=1920,fps=30,showCaptions=true}={}) {
  if(typeof showCaptions!=='boolean')throw new Error('showCaptions must be boolean');
  lesson.showCaptions=showCaptions;
  if(![[1080,1920],[1440,2560],[2160,3840]].some(([w,h])=>width===w&&height===h)||![30,60].includes(fps))
    throw new Error('Supported output: 1080p/1440p/4K portrait at 30/60 fps');
  const ratio=fps/lesson.fps,frame=n=>Math.round(n*ratio);
  // Preserve the original timeline in seconds, including pen enter/exit phases.
  lesson.durationFrames=frame(lesson.durationFrames);
  lesson.width=width;lesson.height=height;lesson.fps=fps;
  lesson.duration=lesson.durationFrames/fps;
  for(const timing of Object.values(lesson.segmentTimings)) {
    timing.startFrame=frame(timing.startFrame);timing.endFrame=frame(timing.endFrame);
  }
  for(const page of lesson.pages) {
    page.startFrame=frame(page.startFrame);page.endFrame=frame(page.endFrame);
    Object.assign(page.board,{width,height,fps,duration:lesson.duration});
    for(const target of Object.values(page.targets))target.visibleFrom=frame(target.visibleFrom);
    for(const gesture of page.gestures)for(const field of ['startFrame','endFrame','activeStart','activeEnd'])gesture[field]=frame(gesture[field]);
  }
  for(const caption of lesson.captions) {
    caption.startFrame=frame(caption.startFrame);caption.endFrame=frame(caption.endFrame);
  }
  return lesson;
}
