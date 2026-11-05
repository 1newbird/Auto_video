"""Compose one state in memory and pipe PNG packets directly to FFmpeg."""
from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image


def encode(spec):
    states = spec["states"]
    if sum(s["frames"] for s in states) != spec["frames"]:
        raise ValueError("State frame count does not match output duration")
    output = Path(spec["output"])
    error_file = output.with_suffix(".ffmpeg.log")

    @lru_cache(maxsize=4)
    def load(file):
        with Image.open(file) as im:
            return im.convert("RGBA")

    args = [spec["ffmpeg"], "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-f", "image2pipe", "-framerate", str(spec["fps"]), "-vcodec", "png", "-i", "pipe:0",
            "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-frames:v", str(spec["frames"]), "-movflags", "+faststart", str(output)]
    with error_file.open("wb") as errors:
        proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            for state in states:
                picture = load(state["board"]).copy()
                if state.get("caption"):
                    picture.alpha_composite(load(state["caption"]))
                buffer = BytesIO()
                picture.convert("RGB").save(buffer, format="PNG", compress_level=1)
                packet = buffer.getvalue()
                for _ in range(state["frames"]):
                    proc.stdin.write(packet)
            proc.stdin.close()
            code = proc.wait()
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        finally:
            if not proc.stdin.closed:
                proc.stdin.close()
    if code:
        raise RuntimeError(error_file.read_text(encoding="utf-8", errors="replace")[-2000:])
    error_file.unlink(missing_ok=True)
    return {"encoder": "png-pipe", "compositesCreated": 0, "streamedFrames": spec["frames"]}


if __name__ == "__main__":
    try:
        print(json.dumps(encode(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))))
    except BrokenPipeError:
        print("FFmpeg 提前退出；具体错误见输出目录内 .ffmpeg.log。", file=sys.stderr)
        sys.exit(1)
