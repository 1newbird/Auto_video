"""Inspect actual lesson frames and decoded MP4, including content-layer visibility."""
from pathlib import Path
import json
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out=Path(sys.argv[1]);ffmpeg=sys.argv[2]
manifest=json.loads((out/'render-manifest.json').read_text(encoding='utf-8'))
lesson=manifest['lesson'];frames=manifest['frames'];checks=[]
def file(n): return out/'frames'/f'{n:05}.png'
def pix(p): return np.asarray(Image.open(p).convert('RGB'))
def check(name,ok,**detail): checks.append({'check':name,'passed':bool(ok),**detail})
check('repeat_final_frame',np.array_equal(pix(file(frames[-1])),pix(out/'frames/repeat.png')))
desk=pix(file(0))[:100]
check('fixed_desk_texture',all(np.array_equal(desk,pix(file(n))[:100]) for n in frames))
for page in lesson['pages']:
    p=pix(file(page['endFrame']-1))[250:1550,70:1020]
    dark=np.all(p<110,axis=2)
    check('board_layer_visible',dark.sum()>2500,page=page['id'],dark_pixels=int(dark.sum()))
    caption=next(c for c in lesson['captions'] if c['pageId']==page['id'])
    crop=pix(file(caption['startFrame']))[1640:1810,60:1020]
    check('caption_layer_visible',np.all(crop<90,axis=2).sum()>400,page=page['id'])
    yellow=(crop[:,:,0]>200)&(crop[:,:,1]>160)&(crop[:,:,2]<130)
    check('yellow_caption_in_raised_safe_area',yellow.sum()>300,page=page['id'],yellow_pixels=int(yellow.sum()))
    red=next((t for t in page['targets'].values() if t['red']),None)
    if red:
        n=red['visibleFrom'];a=pix(file(n-1)).astype(np.int16);b=pix(file(n)).astype(np.int16)
        changed=np.max(np.abs(a-b),axis=2)>25
        red_pixels=(b[:,:,0]>b[:,:,1]*1.35)&(b[:,:,0]>b[:,:,2]*1.2)&changed
        check('red_note_precedes_narration',red_pixels.sum()>100 and n<lesson['segmentTimings'][red['segment']]['startFrame'],page=page['id'],new_red_pixels=int(red_pixels.sum()))

decoded=out/'decoded';decoded.mkdir(exist_ok=True)
# One decoder feeds all exact-frame trims. The bundled FFmpeg has split/trim,
# but not select; this avoids a full rescan for every sample without a new binary.
filters=[f"[0:v]split={len(frames)}"+''.join(f'[s{i}]' for i in range(len(frames)))]
filters += [f'[s{i}]trim=start_frame={n}:end_frame={n+1}[v{i}]' for i,n in enumerate(frames)]
filter_file=out/'decode-filter.txt';filter_file.write_text(';\n'.join(filters),encoding='utf-8')
command=[ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-i',str(out/'lesson.mp4'),'-filter_complex_script',str(filter_file)]
for i,n in enumerate(frames):command += ['-map',f'[v{i}]','-frames:v','1','-fps_mode','vfr','-threads','1','-update','1',str(decoded/f'{n:05}.png')]
result=subprocess.run(command,capture_output=True,text=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
if result.returncode:raise RuntimeError(result.stderr)
for n in frames:
    dest=decoded/f'{n:05}.png'
    a=pix(file(n)).astype(np.int16);b=pix(dest).astype(np.int16)
    error=float(np.abs(a-b).mean())
    check('decoded_video_matches_source',error<4,frame=n,mean_absolute_error=round(error,4))

# Compare new-ink masks at exact reveal and page-cut boundaries, avoiding blank-paper bias.
boundaries=set(p['startFrame'] for p in lesson['pages'][1:])
for page in lesson['pages']:
    red=next((t for t in page['targets'].values() if t['red']),None)
    if red:boundaries.add(red['visibleFrom'])
for n in sorted(boundaries):
    a=pix(file(n-1)).astype(np.int16);b=pix(file(n)).astype(np.int16)
    mask=np.max(np.abs(a-b),axis=2)>25
    va=pix(decoded/f'{n-1:05}.png').astype(np.int16);vb=pix(decoded/f'{n:05}.png').astype(np.int16)
    errors=[float(np.abs(va-a)[mask].mean()),float(np.abs(vb-b)[mask].mean())]
    wrong=[float(np.abs(va-b)[mask].mean()),float(np.abs(vb-a)[mask].mean())]
    # 4:2:0 subsampling spreads thin red strokes across chroma pixels. Timing is
    # checked on both luma and RGB against the wrong frame, not RGB alone.
    luma=np.array([.2126,.7152,.0722])
    luma_errors=[float(np.abs((va-a)@luma)[mask].mean()),float(np.abs((vb-b)@luma)[mask].mean())]
    luma_wrong=[float(np.abs((va-b)@luma)[mask].mean()),float(np.abs((vb-a)@luma)[mask].mean())]
    ok=all(e<min(24,w*.25) for e,w in zip(errors,wrong)) and all(e<min(8,w*.2) for e,w in zip(luma_errors,luma_wrong))
    check('encoded_boundary_on_exact_frame',ok,frame=n,rgb_errors=errors,luma_errors=luma_errors,wrong_frame_luma_errors=luma_wrong)

selected=[]
for page in lesson['pages']:
    selected.append(page['endFrame']-1)
    selected.extend(int((g['activeStart']+g['activeEnd'])//2) for g in page['gestures'][:3])
columns=4;tw=270;th=480;rows=(len(selected)+columns-1)//columns
sheet=Image.new('RGB',(columns*294+24,rows*534+24),'#e5e1d8');draw=ImageDraw.Draw(sheet)
try:font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',19)
except OSError:font=ImageFont.load_default()
for i,n in enumerate(selected):
    x=24+i%columns*294;y=24+i//columns*534
    sheet.paste(Image.open(file(n)).convert('RGB').resize((tw,th),Image.Resampling.LANCZOS),(x,y))
    draw.text((x,y+th+8),f'{n/30:.1f}s / frame {n}',fill='#383530',font=font)
sheet.save(out/'storyboard.jpg',quality=94)
report={'passed':all(c['passed'] for c in checks),'checks':checks}
(out/'visual-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(f'Lesson image/video checks: {sum(c["passed"] for c in checks)}/{len(checks)} passed')
if not report['passed']:
    print(json.dumps([c for c in checks if not c['passed']],indent=2));sys.exit(1)
