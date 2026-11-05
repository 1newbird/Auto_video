"""Validate a bounded render against its original timeline and persistent ink."""
from pathlib import Path
import json
import math
import subprocess
import sys
import numpy as np
from PIL import Image

out=Path(sys.argv[1]);bin_dir=Path(sys.argv[2])
m=json.loads((out/'clip-manifest.json').read_text(encoding='utf-8'))
lesson=m['lesson'];first,last=m['frameRange'];frames=m['frames'];checks=[]
fps=lesson['fps'];scale=lesson['width']/1080
def check(name,ok,**data): checks.append({'check':name,'passed':bool(ok),**data})
def run(args):
    r=subprocess.run(args,capture_output=True,text=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout
def pix(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.int16)
probe=json.loads(run([str(bin_dir/'ffprobe.exe'),'-v','error','-count_frames','-show_streams','-show_format','-of','json',str(out/'clip.mp4')]))
v=next(s for s in probe['streams'] if s['codec_type']=='video')
check('codec_dimensions_fps',v['codec_name']=='h264' and v['pix_fmt']=='yuv420p' and v['width']==lesson['width'] and v['height']==lesson['height'] and v['avg_frame_rate']==f'{fps}/1')
check('actual_frame_count',int(v['nb_read_frames'])==last-first+1,frames=int(v['nb_read_frames']))
check('duration',abs(float(probe['format']['duration'])-(last-first+1)/fps)<1/fps,seconds=float(probe['format']['duration']))
check('audio_presence',any(s['codec_type']=='audio' for s in probe['streams'])==bool(lesson.get('audio')))
check('repeat_frame',np.array_equal(pix(out/'frames'/f'{last:05}.png'),pix(out/'frames/clip-repeat.png')))
decoded=out/'clip-decoded';decoded.mkdir(exist_ok=True)
for n in frames:
    relative=n-first
    run([str(bin_dir/'ffmpeg.exe'),'-hide_banner','-loglevel','error','-nostdin','-y','-i',str(out/'clip.mp4'),
        '-vf',f'trim=start_frame={relative}:end_frame={relative+1}','-frames:v','1','-fps_mode','vfr','-update','1',str(decoded/f'{n:05}.png')])
    error=float(np.abs(pix(decoded/f'{n:05}.png')-pix(out/'frames'/f'{n:05}.png')).mean())
    check('clip_matches_original_timeline',error<4,original_frame=n,clip_frame=relative,mean_absolute_error=round(error,4))

def screen_crop(box,paper):
    a=math.radians(paper['rotation']);points=[]
    for x in [box['x']-20,box['x']+box['w']+20]:
        for y in [box['y']-20,box['y']+box['h']+20]:
            points.append((540+(x-540)*math.cos(a)-(y-900)*math.sin(a),paper['top']+900+(x-540)*math.sin(a)+(y-900)*math.cos(a)))
    return (slice(max(0,int(min(p[1] for p in points)*scale)),min(lesson['height'],math.ceil(max(p[1] for p in points)*scale))),
        slice(max(0,int(min(p[0] for p in points)*scale)),min(lesson['width'],math.ceil(max(p[0] for p in points)*scale))))
def red(p): return (p[:,:,0]>p[:,:,1]*1.35)&(p[:,:,0]>p[:,:,2]*1.25)&(p[:,:,0]>80)
for page in lesson['pages']:
    for g in page['gestures']:
        before=g['startFrame']-1;after=g['endFrame']
        if g['ink'] and before in frames and after in frames:
            crop=screen_crop(page['targets'][g['target']],page['board']['paper'])
            a=pix(decoded/f'{before:05}.png')[crop];b=pix(decoded/f'{after:05}.png')[crop]
            new_ink=red(b)&~red(a)
            check('ink_persists_after_pen_exits',new_ink.sum()>60*scale**2,gesture=g['id'],new_red_pixels=int(new_ink.sum()))

report={'passed':all(c['passed'] for c in checks),'frameRange':[first,last],'duration':(last-first+1)/fps,'bytes':int(probe['format']['size']),'checks':checks}
(out/'clip-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'passed':report['passed'],'checks':len(checks),'duration':report['duration'],'bytes':report['bytes'],'failures':[c for c in checks if not c['passed']]},indent=2))
if not report['passed']:sys.exit(1)
