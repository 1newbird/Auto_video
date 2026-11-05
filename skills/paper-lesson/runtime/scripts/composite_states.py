"""Composite only changed image states; FFmpeg repeats holds at the original fps."""
from pathlib import Path
from functools import lru_cache
import json, sys
from PIL import Image

spec=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
out=Path(spec['cache']);out.mkdir(exist_ok=True,parents=True)
@lru_cache(maxsize=8)
def load(file):
    with Image.open(file) as im: return im.convert('RGBA')

lines=['ffconcat version 1.0'];created=0;reused=0
def entry(file,frames):
    # ffconcat uses its own quoting, never a shell.
    name=str(file.resolve()).replace('\\','/').replace("'", "'\\''")
    # Anchor both the first and last held frame. CFR resampling otherwise chooses
    # the next state one frame early at sparse timestamp boundaries.
    if frames>1:lines.extend([f"file '{name}'",f"option framerate {spec['fps']}",f"duration {(frames-1)/spec['fps']:.9f}"])
    lines.extend([f"file '{name}'",f"option framerate {spec['fps']}",f"duration {1/spec['fps']:.9f}"])
for state in spec['states']:
    dest=out/(state['key']+'.png')
    if not dest.exists():
        board=load(state['board']).copy()
        if state['caption']:board.alpha_composite(load(state['caption']))
        temp=dest.with_suffix('.tmp.png');board.convert('RGB').save(temp,compress_level=1);temp.replace(dest);created+=1
    else: reused+=1
    entry(dest,state['frames'])
# Supply a final packet; output is capped to exactly the requested frame count.
entry(dest,1)
Path(spec['concat']).write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'compositesCreated':created,'compositesReused':reused}))
