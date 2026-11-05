"""Align the supplied text to local audio with CTranslate2; never transcribe/rewrite it."""
import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import time
import wave


def utf16_length(text):
    return len(text.encode('utf-16-le')) // 2


def map_words(text, words, origin, lower, upper):
    """Map tokenizer pieces back to exact source spans, including Chinese and English."""
    cursor = 0
    mapped = []
    for item in words:
        token = item['word']
        if not token:
            continue
        if not text.startswith(token, cursor):
            raise ValueError(f'Alignment text changed near {text[cursor:cursor+24]!r}')
        end = cursor + len(token)
        start_seconds = max(lower, min(upper, origin + float(item['start'])))
        end_seconds = max(start_seconds, min(upper, origin + float(item['end'])))
        mapped.append(dict(text=token, start=utf16_length(text[:cursor]), end=utf16_length(text[:end]),
                           startSeconds=round(start_seconds, 4), endSeconds=round(end_seconds, 4)))
        cursor = end
    if text[cursor:].strip():
        raise ValueError('Alignment did not cover the supplied transcript')
    return mapped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--models', required=True)
    args = parser.parse_args()
    source = json.loads(Path(args.source).read_text(encoding='utf-8-sig'))
    audio_file = Path(source['audio']['path'])
    if hashlib.sha256(audio_file.read_bytes()).hexdigest() != source['audio']['sha256']:
        raise ValueError('Narration hash changed')
    from faster_whisper import WhisperModel
    from faster_whisper.audio import pad_or_trim
    from faster_whisper.tokenizer import Tokenizer
    from faster_whisper.utils import download_model
    from huggingface_hub.errors import LocalEntryNotFoundError
    import numpy as np

    started = time.perf_counter()
    # Explicit output-root cache; no default user-profile downloads.
    revision = '536b0662742c02347bc0e980a01041f333bce120'
    try:
        model_path = download_model('small', cache_dir=args.models, revision=revision, local_files_only=True)
    except LocalEntryNotFoundError:
        print('Downloading the local alignment model once (about 0.5 GB).', flush=True)
        model_path = download_model('small', cache_dir=args.models, revision=revision)
    model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4)
    tokenizer = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task='transcribe', language='zh')
    # Reuse the bundled FFmpeg; avoid PyAV decoder API changes and temporary WAV files.
    ffmpeg = Path(__file__).resolve().parents[1] / 'node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe'
    pcm = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(audio_file), '-vn', '-ac', '1', '-ar', '16000',
                          '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], capture_output=True,
                         check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    with wave.open(io.BytesIO(pcm.stdout), 'rb') as stream:
        audio = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
    segments = {}
    warnings = []
    for segment in source['segments']:
        text = segment['text'].rstrip()
        lo, hi = segment['startSeconds'], segment['endSeconds']
        if hi-lo > 29:
            raise ValueError(f"{segment['id']}: SRT cue exceeds 29 seconds; provide shorter timestamped cues or import word timings")
        # Small real-audio margins prevent cutting initial/final phonemes at rounded SRT boundaries.
        origin = max(0, lo-.12)
        clip = audio[round(origin*16000):round(min(len(audio)/16000, hi+.12)*16000)]
        tokens = tokenizer.encode(text)
        if len(tokens) > 440:
            raise ValueError(f"{segment['id']}: too much text in one cue; split the timestamped cue")
        features = model.feature_extractor(clip)
        num_frames = min(features.shape[-1], model.feature_extractor.nb_max_frames)
        encoded = model.encode(pad_or_trim(features))
        # Forced text/audio alignment, not model.transcribe() or a generated transcript.
        aligned = model.find_alignment(tokenizer, [tokens], encoded, [num_frames])[0]
        words = map_words(text, aligned, origin, lo, hi)
        if not words:
            raise ValueError(f"{segment['id']}: no word alignment")
        zero = sum(w['endSeconds'] <= w['startSeconds'] and any(c.isalnum() for c in w['text']) for w in words)
        if zero:
            warnings.append(dict(segment=segment['id'], zeroDurationPieces=zero))
        segments[segment['id']] = words
        print(f"Aligned {segment['id']}: {len(words)} text pieces", flush=True)
    result = dict(schemaVersion=1, sourceHash=source['sha256'], audioHash=source['audio']['sha256'],
                  cueTimes=[[s['id'], s['startSeconds'], s['endSeconds']] for s in source['segments']],
                  method='local-forced-alignment', model='Systran/faster-whisper-small', modelRevision=revision, engine='faster-whisper==1.2.1',
                  segments=segments, warnings=warnings, alignmentSeconds=round(time.perf_counter()-started, 3))
    target = Path(args.out)
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(target)
    print(f"Word alignment saved: {target} ({result['alignmentSeconds']}s)", flush=True)


if __name__ == '__main__':
    main()
