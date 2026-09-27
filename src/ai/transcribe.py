#!/usr/bin/env python3
"""Interview recording -> transcript with speakers, on this machine, free (no API).

Open-source parts, run through sherpa-onnx (k2-fsa, Apache-2.0: ONNX Runtime, no PyTorch, no tokens):
- Silero VAD cuts the audio at pauses into pieces of at most MAX_PIECE seconds;
- NVIDIA Parakeet-TDT 0.6B v2 (English) transcribes each piece with a time for every token;
- pyannote segmentation 3.0 + the 3D-Speaker ERes2Net voice embedding (English VoxCeleb) find who spoke when;
- each word goes to the speaker talking at its time, and consecutive words of one speaker make a turn;
- in the app's stereo recordings (microphone left, the call's audio right) the speaker heard on the
  microphone and not in the call is labelled "You".
This is the WhisperX recipe (ASR + diarization, aligned by word time) without the heavy stack.

Audio is decoded by PyAV (bundled FFmpeg), so webm/opus from the app's recorder, m4a, mp3, wav, mp4
and Telegram voice notes all work. Models (~520 MB) download once into MODELS_DIR.

The output is plain text that interviews.run() reads like any transcript:
    [00:00:03] Speaker 1: Thanks for joining. Could you ...
    [00:00:11] Speaker 2: Sure. Last year ...

Usage: python -m src.ai.transcribe <audio> [--speakers N] [--out file.txt]
Progress goes to stderr as lines "progress <stage> <0-100>", for the desktop app's bar.
"""
import argparse
import bisect
import os
import sys
import tarfile
import urllib.request
from pathlib import Path

RATE = 16_000
MAX_PIECE = 20          # seconds of speech per ASR piece; Parakeet is accurate and light at this size
AUDIO_TYPES = ('.webm', '.m4a', '.mp3', '.wav', '.ogg', '.oga', '.opus', '.mp4', '.mov', '.aac', '.flac', '.aiff', '.mkv')
RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
# English for now. For German/French etc. switch to sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 (25 languages).
ASR_MODEL = os.getenv('JOB_PILOTTO_ASR_MODEL', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8')
MODELS = {
    'vad': (f'{RELEASES}/asr-models/silero_vad.onnx', 'silero_vad.onnx'),
    'segmentation': (f'{RELEASES}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
                     'sherpa-onnx-pyannote-segmentation-3-0/model.onnx'),
    'embedding': (f'{RELEASES}/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
                  '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx'),
    'asr': (f'{RELEASES}/asr-models/{ASR_MODEL}.tar.bz2', f'{ASR_MODEL}/tokens.txt'),
}


def models_dir():
    if os.getenv('JOB_PILOTTO_MODELS_DIR'):
        return Path(os.environ['JOB_PILOTTO_MODELS_DIR'])
    return Path.home() / ('Library/Caches' if sys.platform == 'darwin' else '.cache') / 'job-pilotto' / 'models'


def available():
    """True when the transcription libraries are installed (they're optional: the core doesn't need them)
    and JOB_PILOTTO_DISABLE doesn't list "transcribe"."""
    from .. import features
    if features.disabled('transcribe'):
        return False
    try:
        import av, numpy, sherpa_onnx  # noqa: F401
        return True
    except ImportError:
        return False


def progress(stage, percent):
    print(f'progress {stage} {int(percent)}', file=sys.stderr, flush=True)


def ensure_models(folder=None, opener=urllib.request.urlopen):
    """Download any missing model (once) and return {name: path}."""
    folder = Path(folder or models_dir())
    folder.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, (url, relative) in MODELS.items():
        target = folder / relative
        if not target.exists():
            progress(f'download-{name}', 0)
            partial = folder / (url.rsplit('/', 1)[-1] + '.part')
            with opener(url, timeout=60) as response, open(partial, 'wb') as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            if url.endswith('.tar.bz2'):
                with tarfile.open(partial, 'r:bz2') as archive:
                    archive.extractall(folder, filter='data')
                partial.unlink()
            else:
                partial.rename(target)
            progress(f'download-{name}', 100)
        paths[name] = target
    return paths


def load_audio(path):
    """(mono, channels) at 16 kHz from any audio/video file: mono float32 samples, and for a stereo file
    its two channels as a (2, n) array (the app records your microphone left and the call right), else None."""
    import av
    import numpy as np
    chunks = []
    with av.open(str(path)) as container:
        stream = next(s for s in container.streams if s.type == 'audio')
        stereo = stream.codec_context.channels == 2
        # Packed 32-bit float: stereo frames come interleaved (L R L R ...), one row per frame.
        resampler = av.AudioResampler(format='flt', layout='stereo' if stereo else 'mono', rate=RATE)
        for frame in list(container.decode(stream)) + [None]:
            chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
    samples = np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)
    if not stereo:
        return samples, None
    channels = samples.reshape(-1, 2).T
    return channels.mean(axis=0), channels


def find_you(channels, segments, ratio=4.0):
    """The speaker index heard mostly on the microphone channel (left) and hardly in the call (right),
    or None. A normal stereo file has both channels alike, so nobody passes the ratio."""
    import numpy as np
    if channels is None:
        return None
    energy = {}
    for start, end, speaker in segments:
        a, b = int(start * RATE), int(end * RATE)
        left, right = (float(np.mean(np.square(c[a:b]))) if b > a else 0.0 for c in channels)
        mic, call = energy.get(speaker, (0.0, 0.0))
        energy[speaker] = (mic + left * (end - start), call + right * (end - start))
    scored = {s: mic / max(call, 1e-9) for s, (mic, call) in energy.items() if mic > 0}
    best = max(scored, key=scored.get, default=None)
    return best if best is not None and scored[best] >= ratio else None


def speech_pieces(samples, vad_model):
    """[(start_second, samples)] of speech, split at pauses, each at most MAX_PIECE seconds."""
    import sherpa_onnx
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(vad_model)
    config.silero_vad.min_silence_duration = 0.4
    config.silero_vad.max_speech_duration = MAX_PIECE
    config.sample_rate = RATE
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=MAX_PIECE * 3)
    pieces, window = [], config.silero_vad.window_size
    for i in range(0, len(samples), window):
        vad.accept_waveform(samples[i:i + window])
        while not vad.empty():
            pieces.append((vad.front.start / RATE, vad.front.samples))
            vad.pop()
    vad.flush()
    while not vad.empty():
        pieces.append((vad.front.start / RATE, vad.front.samples))
        vad.pop()
    return pieces


def recognize(pieces, asr_folder, threads=4):
    """[(time, word)] over the whole recording, from the pieces' token timestamps."""
    import sherpa_onnx
    folder = Path(asr_folder)
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(folder / 'encoder.int8.onnx'), decoder=str(folder / 'decoder.int8.onnx'),
        joiner=str(folder / 'joiner.int8.onnx'), tokens=str(folder / 'tokens.txt'),
        model_type='nemo_transducer', num_threads=threads)
    words = []
    for n, (start, samples) in enumerate(pieces):
        stream = recognizer.create_stream()
        stream.accept_waveform(RATE, samples)
        recognizer.decode_stream(stream)
        words += tokens_to_words(stream.result.tokens, stream.result.timestamps, start)
        progress('transcribe', 100 * (n + 1) / len(pieces))
    return words


def tokens_to_words(tokens, timestamps, offset=0.0):
    """Sentencepiece tokens (a leading space starts a new word) -> [(time of first token, word)]."""
    words = []
    for token, time in zip(tokens, timestamps):
        if token.startswith((' ', '▁')) or not words:
            words.append([offset + time, token.replace('▁', ' ').strip()])
        else:
            words[-1][1] += token
    return [(round(t, 2), w) for t, w in words if w]


def diarize(samples, segmentation, embedding, speakers=0, threads=4):
    """[(start, end, speaker index)] sorted by start. speakers=0 lets clustering decide how many."""
    import sherpa_onnx
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(segmentation)),
            num_threads=threads),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(embedding), num_threads=threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=speakers or -1, threshold=0.6),
        min_duration_on=0.3, min_duration_off=0.5)
    engine = sherpa_onnx.OfflineSpeakerDiarization(config)

    def report(done, total):
        progress('speakers', 100 * done / max(total, 1))
        return 0
    result = engine.process(samples, callback=report).sort_by_start_time()
    return [(s.start, s.end, s.speaker) for s in result]


def assign(words, segments):
    """Each word to the speaker whose segment covers its time (else the nearest segment)."""
    if not segments:
        return [(t, 0, w) for t, w in words]
    starts = [s[0] for s in segments]
    out = []
    for time, word in words:
        i = bisect.bisect_right(starts, time) - 1
        near = [segments[j] for j in (i, i + 1) if 0 <= j < len(segments)]
        covering = [s for s in near if s[0] <= time <= s[1]]
        best = covering[0] if covering else min(near, key=lambda s: min(abs(time - s[0]), abs(time - s[1])))
        out.append((time, best[2], word))
    return out


def turns(labelled, you=None):
    """[(start, speaker, text)]: consecutive words of one speaker joined. Speakers are renumbered 1, 2, ...
    in the order they first speak, so "Speaker 1" is whoever opened the call; `you` (a diarization index)
    becomes speaker 0, shown as "You"."""
    order, result = ({you: 0} if you is not None else {}), []
    for time, speaker, word in labelled:
        number = order.setdefault(speaker, len(order) + (1 if you is None else 0))
        if result and result[-1][1] == number:
            result[-1][2].append(word)
        else:
            result.append((time, number, [word]))
    return [(t, s, ' '.join(ws)) for t, s, ws in result]


def clock(seconds):
    seconds = int(seconds)
    return f'{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}'


def render(turn_list, names=None):
    names = {0: 'You', **(names or {})}
    return '\n'.join(f'[{clock(t)}] {names.get(s, f"Speaker {s}")}: {text}' for t, s, text in turn_list)


def transcribe(path, speakers=0, models=None, threads=None):
    """Speaker-labelled transcript text of one recording."""
    threads = threads or max(1, min(8, (os.cpu_count() or 4) - 2))
    models = models or ensure_models()
    progress('decode', 0)
    samples, channels = load_audio(path)
    if len(samples) < RATE:
        raise ValueError(f'{Path(path).name}: less than a second of audio')
    progress('decode', 100)
    pieces = speech_pieces(samples, models['vad'])
    if not pieces:
        raise ValueError(f'{Path(path).name}: no speech found')
    words = recognize(pieces, models['asr'].parent, threads)
    segments = diarize(samples, models['segmentation'], models['embedding'], speakers, threads)
    return render(turns(assign(words, segments), find_you(channels, segments)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('audio', type=Path)
    parser.add_argument('--speakers', type=int, default=0, help='number of people on the call, if known (0 = detect)')
    parser.add_argument('--out', type=Path, help='write the transcript here (default: print it)')
    parser.add_argument('--download-only', action='store_true', help='fetch the models and stop')
    args = parser.parse_args(argv)
    if args.download_only:
        ensure_models()
        return 0
    text = transcribe(args.audio, args.speakers)
    if args.out:
        args.out.write_text(text + '\n', encoding='utf-8')
        print(args.out)
    else:
        print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
