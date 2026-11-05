"""One-time download of the pinned local alignment model (no user audio uploaded)."""
import hashlib
from pathlib import Path
import time
import urllib.request

MODEL_DIR = Path(__file__).resolve().parent / "runtime/models/fa-zh"
REVISION = "d7701644d6e336f093501241beca010519c0986f"
MODEL_SHA256 = "f34ede558af831fb504206b25f1c2f27ca2f77753c26c4dd38d03323153b6f73"
FILES = ("README.md", "am.mvn", "config.yaml", "configuration.json", "seg_dict", "tokens.json", "model.pt")


def setup():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        dest = MODEL_DIR / name
        if dest.is_file() and (name != "model.pt" or hashlib.sha256(dest.read_bytes()).hexdigest() == MODEL_SHA256):
            print(f"[安装] 已有 {name}", flush=True)
            continue
        url = f"https://huggingface.co/funasr/fa-zh/resolve/{REVISION}/{name}"
        temp = dest.with_suffix(dest.suffix + ".download")
        print(f"[安装] 下载 {name}", flush=True)
        last = time.monotonic()
        with urllib.request.urlopen(url, timeout=120) as response, temp.open("wb") as output:
            total = 0
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                total += len(chunk)
                if time.monotonic() - last > 5:
                    print(f"[安装] {name}: {total / 1024**2:.1f} MiB", flush=True)
                    last = time.monotonic()
        if name == "model.pt" and hashlib.sha256(temp.read_bytes()).hexdigest() != MODEL_SHA256:
            raise RuntimeError("模型校验失败，请重新运行 setup_alignment.py")
        temp.replace(dest)
    print(f"[安装] 对齐模型就绪：{MODEL_DIR}", flush=True)


if __name__ == "__main__":
    setup()
