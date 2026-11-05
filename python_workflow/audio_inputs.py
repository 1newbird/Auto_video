"""Local audio + SRT input. No speech service or model calls."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from subtitle_normalization import normalize_groups


def parse_srt(text, *, skip_control_cues=False):
    cues = []
    previous_end = 0
    stamp = r"(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})"
    pattern = re.compile(rf"^{stamp}\s*-->\s*{stamp}\s*$")
    tags = r"breath|laughs|chuckle|coughs|clear-throat|groans|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|sneezes"
    for block in re.split(r"\n\s*\n", text.lstrip("\ufeff").replace("\r\n", "\n").strip()):
        lines = block.splitlines()
        if lines and lines[0].strip().isdigit():
            lines = lines[1:]
        match = pattern.fullmatch(lines[0].strip()) if lines else None
        if not match or len(lines) < 2:
            raise ValueError("字幕必须是包含起止时间和文字的 SRT 文件")
        values = list(map(int, match.groups()))
        def seconds(parts):
            h, m, s, ms = parts
            if m >= 60 or s >= 60:
                raise ValueError("SRT 分钟/秒超出范围")
            return h * 3600 + m * 60 + s + ms / 1000
        start, end = seconds(values[:4]), seconds(values[4:])
        body = " ".join(line.strip() for line in lines[1:]).strip()
        if not body or start < previous_end or end <= start:
            raise ValueError("字幕含空文本、重叠或无效的起止时间")
        previous_end = end  # Validate even the control-only cues we later discard.
        body = re.sub(rf"\((?:{tags})\)|<#\d+(?:\.\d+)?#>", "", body, flags=re.I).strip()
        if not body and skip_control_cues:
            continue
        if not body:
            raise ValueError("字幕含空文本、重叠或无效的起止时间")
        cues.append({"id": f"s{len(cues)+1:03d}", "text": body, "startSeconds": start, "endSeconds": end})
    if not cues:
        raise ValueError("字幕为空")
    return cues


def normalized_word(text):
    return "".join(re.findall(r"[A-Za-z0-9\u3400-\u9fff]", text)).lower()


def parse_word_srt(text, *, reference_text='', normalization_report=None):
    """Group provider word fragments for planning; retain their exact timestamps.

    Punctuation and breathing have no word anchor. English fragments remain
    individually timed, so joining Har + ness never invents internal timings.
    Offsets use the same punctuation-free text as resolveWordAnchor in JS.
    """
    fragments = parse_srt(text, skip_control_cues=True)
    cues, pending, groups = [], [], []

    def flush():
        if not pending:
            return
        if any(normalized_word(p['text']) for p in pending):
            groups.append(list(pending))
        elif groups:
            groups[-1].extend(pending)
        pending.clear()

    for item in fragments:
        if pending and normalized_word(item["text"]) and item["startSeconds"] - pending[-1]["endSeconds"] >= 1:
            flush()
        pending.append(item)
        body = "".join(part["text"] for part in pending)
        # Group BEFORE repairs so old plans keep the same segment IDs/times.
        if re.search(r"[。！？!?；;][\"'”’）)]*$", body) or (len(body) >= 100 and re.search(r"[，,：:]$", body)):
            flush()
    flush()
    raw_text = ''.join(p['text'] for group in groups for p in group)
    if reference_text:
        groups, report = normalize_groups(groups, reference_text)
        report['sourceHashBefore'] = hashlib.sha256(raw_text.encode()).hexdigest()
        report['sourceHashAfter'] = hashlib.sha256(''.join(p['text'] for g in groups for p in g).encode()).hexdigest()
        if normalization_report is not None:
            normalization_report.update(report)
    for pending in groups:
        body = "".join(item["text"] for item in pending)
        words, offset = [], 0
        for item in pending:
            token = normalized_word(item["text"])
            if token:
                words.append({"text": item["text"], "from": offset, "to": offset + len(token),
                              "startSeconds": item["startSeconds"], "endSeconds": item["endSeconds"]})
                offset += len(token)
        if words:
            cues.append({"id": f"s{len(cues)+1:03d}", "text": body,
                         "startSeconds": pending[0]["startSeconds"], "endSeconds": pending[-1]["endSeconds"],
                         "words": words})
        elif cues:
            # Keep punctuation adjacent to a preceding sentence, not as a new page anchor.
            cues[-1]["text"] += body
            cues[-1]["endSeconds"] = pending[-1]["endSeconds"]
    if not cues:
        raise ValueError("词级字幕没有可用的字词")
    return cues


def probe(path, binaries):
    result = subprocess.run([str(binaries / "ffprobe.exe"), "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,duration,width,height,r_frame_rate", "-of", "json", str(path)],
        capture_output=True, text=True, encoding="utf-8", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
    return json.loads(result.stdout)


def prepare_audio(audio_file, subtitle_file, folder, binaries, *, keyword_sync=True, reference_text=''):
    audio = folder / ("audio" + audio_file.suffix.lower())
    shutil.copyfile(audio_file, audio)
    shutil.copyfile(subtitle_file, folder / "input-subtitles.srt")
    metadata = probe(audio, binaries)
    if not any(s.get("codec_type") == "audio" for s in metadata["streams"]):
        raise ValueError("指定文件不含音轨")
    duration = float(metadata["format"]["duration"])
    if not 0 < duration <= 1800:
        raise ValueError("音频时长必须在 0～1800 秒内")
    text = (folder / "input-subtitles.srt").read_text(encoding="utf-8-sig")
    word_input = subtitle_file.name.lower().endswith(".word.srt")
    normalization = {}
    cues = parse_word_srt(text, reference_text=reference_text, normalization_report=normalization) if word_input else parse_srt(text)
    # Check the raw final timestamp too, including any trailing breathing tag.
    if word_input:
        stamps = re.findall(r"-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})", text)
        h, m, s, ms = map(int, stamps[-1])
        if h * 3600 + m * 60 + s + ms / 1000 > duration + 0.05:
            raise ValueError("字幕结束时间超过音频时长，请提供与音频匹配的字幕")
    if cues[-1]["endSeconds"] > duration + 0.05:
        raise ValueError("字幕结束时间超过音频时长，请提供与音频匹配的字幕")
    timeline = {"schemaVersion": 1, "duration": duration, "cues": cues,
        "audioSha256": hashlib.sha256(audio.read_bytes()).hexdigest(),
        "granularity": "sentence", "captionSplitTiming": "proportional-within-cue"}
    if word_input:
        if normalization:
            timeline['subtitleNormalization'] = normalization
            (folder / 'subtitle-normalization.json').write_text(json.dumps(normalization, ensure_ascii=False, indent=2), encoding='utf-8')
        timeline["granularity"] = "character/word"
        timeline["wordImport"] = {"format": "word.srt", "wordCount": sum(len(c["words"]) for c in cues),
                                  "subtitleSha256": hashlib.sha256(text.encode()).hexdigest()}
        if keyword_sync:
            timeline["alignment"] = {"engine": "imported-word-srt-v1", "granularity": "character/word",
                                     "seconds": 0, "failedCues": []}
    (folder / "audio-timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    return audio, timeline


def verify_mux(video, duration, binaries):
    metadata = probe(video, binaries)
    streams = metadata["streams"]
    if not any(s.get("codec_type") == "audio" for s in streams) or not any(s.get("codec_type") == "video" for s in streams):
        raise RuntimeError("成片缺少音轨或画面")
    # Container/encoder padding can add a few milliseconds; never cut the narration.
    if abs(float(metadata["format"]["duration"]) - duration) > 0.15:
        raise RuntimeError("成片时长与输入音频不符")
    for stream in streams:
        if stream.get("codec_type") in ("audio", "video") and abs(float(stream["duration"]) - duration) > 0.15:
            raise RuntimeError("成片音轨或画面时长与输入音频不符")
    return metadata
