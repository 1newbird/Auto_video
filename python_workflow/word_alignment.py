"""Offline acoustic timestamps for known SRT text; invoked in a short-lived worker."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time

from setup_alignment import MODEL_DIR, REVISION, MODEL_SHA256

VERSION = "fa-zh-cue-v1"
TOKEN = re.compile(r"[a-zA-Z]+|[0-9]|[\u3400-\u9fff]")


def normalized(text):
    return "".join(TOKEN.findall(text)).lower()


def map_words(cue, result):
    """Map model-returned units back to normalized cue offsets, never interpolate."""
    tokens = TOKEN.findall(result["text"])
    times = result["timestamp"]
    if len(tokens) != len(times) or normalized(result["text"]) != normalized(cue["text"]):
        raise ValueError("对齐模型返回文本/时间数量不匹配，未使用字数估算补齐")
    words, offset, last = [], 0, cue["startSeconds"]
    for token, (a, b) in zip(tokens, times):
        start, end = cue["startSeconds"] + a / 1000, cue["startSeconds"] + b / 1000
        if not all(math.isfinite(x) for x in (start, end)) or start < last - .03 or end <= start or end > cue["endSeconds"] + .15:
            raise ValueError("对齐模型返回无效词时间，未使用字数估算补齐")
        end = min(end, cue["endSeconds"])
        if end <= start:
            raise ValueError("词时间超出对应字幕")
        words.append({"text":token,"from":offset,"to":offset+len(token),
                      "startSeconds":round(start,4),"endSeconds":round(end,4)})
        offset += len(token)
        last = end
    return words


def align(audio, timeline, cache_dir, ffmpeg):
    cache_dir.mkdir(parents=True, exist_ok=True)
    # Input identity includes real audio, subtitle text AND boundaries. Never reuse by filename.
    identity = {"version":VERSION,"model":REVISION,"audio":timeline["audioSha256"],
                "cues":[{k:c[k] for k in ("id","text","startSeconds","endSeconds")} for c in timeline["cues"]]}
    key = hashlib.sha256(json.dumps(identity,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    cache = cache_dir / (key + ".json")
    if cache.is_file():
        saved = json.loads(cache.read_text(encoding="utf-8"))
        if saved.get("alignment",{}).get("cacheKey") == key:
            print("[词同步] 复用已有音文对齐结果", flush=True)
            return saved
    if not (MODEL_DIR / "model.pt").is_file():
        raise RuntimeError("缺少本地对齐模型，请先运行 setup_alignment.py（见 README）")
    if hashlib.sha256((MODEL_DIR / "model.pt").read_bytes()).hexdigest() != MODEL_SHA256:
        raise RuntimeError("本地对齐模型校验失败，请重新运行 setup_alignment.py")
    runtime = cache_dir / "runtime"
    runtime.mkdir(exist_ok=True)
    for name in ("HF_HOME", "MODELSCOPE_CACHE", "NUMBA_CACHE_DIR", "TORCH_HOME"):
        os.environ[name] = str(runtime / name.lower())
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["PATH"] = str(ffmpeg.parent) + os.pathsep + os.environ.get("PATH", "")
    print("[词同步] 加载本地音文对齐模型（CPU）", flush=True)
    try:
        import numpy as np
        import soundfile as sf
        from scipy.signal import resample_poly
        from funasr import AutoModel
    except ImportError as exc:
        raise RuntimeError("缺少本地对齐依赖，请按 README 安装 requirements-alignment.txt") from exc
    model = AutoModel(model=str(MODEL_DIR),device="cpu",ncpu=4,disable_update=True,
                      disable_pbar=True,log_level="ERROR")
    waveform, sample_rate = sf.read(str(audio),dtype="float32")
    if waveform.ndim>1:
        waveform=waveform.mean(axis=1)
    if sample_rate != 16000:
        divisor=math.gcd(sample_rate,16000)
        waveform=resample_poly(waveform,16000//divisor,sample_rate//divisor).astype(np.float32)
    started = time.perf_counter()
    for index,cue in enumerate(timeline["cues"]):
        clip = waveform[round(cue["startSeconds"]*16000):round(cue["endSeconds"]*16000)].copy()
        text = " ".join(TOKEN.findall(cue["text"])).lower()
        result = model.generate(input=(clip,text),data_type=("sound","text"),disable_pbar=True)[0]
        try:
            cue["words"] = map_words(cue,result)
        except ValueError as exc:
            cue["words"] = []
            cue["alignmentError"] = str(exc)
            cue["alignmentResult"] = result
            print(f"[词同步] {cue['id']} 无法可靠映射：{exc}",flush=True)
        print(f"[词同步] {index+1}/{len(timeline['cues'])} 段；{len(cue['words'])} 个字/词；已用 {time.perf_counter()-started:.1f}s",flush=True)
    timeline["alignment"] = {"engine":VERSION,"modelRevision":REVISION,"cacheKey":key,
        "seconds":round(time.perf_counter()-started,3),"granularity":"character/word",
        "failedCues":[c["id"] for c in timeline["cues"] if not c["words"]]}
    if timeline["alignment"]["failedCues"]:
        (cache_dir / (key + ".failed.json")).write_text(json.dumps(timeline,ensure_ascii=False,indent=2),encoding="utf-8")
        raise RuntimeError("部分字幕音文对齐失败：" + ", ".join(timeline["alignment"]["failedCues"]))
    pending = cache.with_suffix(".tmp")
    pending.write_text(json.dumps(timeline,ensure_ascii=False,indent=2),encoding="utf-8")
    pending.replace(cache)
    return timeline


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio",type=Path,required=True)
    parser.add_argument("--timeline",type=Path,required=True)
    parser.add_argument("--cache-dir",type=Path,required=True)
    parser.add_argument("--ffmpeg",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    timeline=json.loads(args.timeline.read_text(encoding="utf-8"))
    result=align(args.audio,timeline,args.cache_dir,args.ffmpeg)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
