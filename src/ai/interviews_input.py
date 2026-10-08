"""Interview analysis, the input: a Telegram file, a subtitle file stripped of its timing, a recording transcribed on the
machine. Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_run.py.
"""
import json
from pathlib import Path
import re
import tempfile
import urllib.request

from . import transcribe
from ..telegram import api_base as telegram_api_base
from .interviews_ai import TEXT_TYPES


def download(token, file_id, opener=urllib.request.urlopen):
    """(file name, bytes) of a Telegram document, audio or voice note, via getFile (bots: up to 20 MB)."""
    with opener(f'{telegram_api_base()}/bot{token}/getFile?file_id={file_id}', timeout=20) as response:
        info = json.load(response)
    if not info.get('ok'):
        raise RuntimeError(info.get('description', 'Telegram getFile failed'))
    path = info['result']['file_path']
    with opener(f'{telegram_api_base()}/file/bot{token}/{path}', timeout=60) as response:
        raw = response.read()
    return path.rsplit('/', 1)[-1], raw


def clean(text):
    """Subtitle files (.srt/.vtt) without cue numbers, timings and repeated lines; plain text as is."""
    if not re.search(r'\d\d:\d\d[:.]\d\d[.,]\d{3}\s*-->', text):
        return text.strip()
    lines, last = [], None
    for line in text.splitlines():
        line = line.strip()
        if not line or line == 'WEBVTT' or line.isdigit() or '-->' in line or line.startswith(('NOTE', 'Kind:', 'Language:')):
            continue
        line = re.sub(r'<[^>]+>', '', line)
        if line != last:
            lines.append(line)
        last = line
    return '\n'.join(lines)


def read_input(file_id, token, opener, speakers=0):
    """(file name, transcript text, was it a recording) for a local path or a Telegram file id."""
    if Path(file_id).is_file():
        # The desktop app passes a file from the Mac instead of a Telegram file id.
        name, path, raw = Path(file_id).name, Path(file_id), None
    else:
        name, raw = download(token, file_id, opener)
        path = None
    lower = name.lower()
    if lower.endswith(transcribe.AUDIO_TYPES):
        if not transcribe.available():
            raise ValueError(f'{name}: recordings need the transcription add-on (pip install -r requirements-transcribe.txt); '
                             'or send a text transcript')
        if path:
            return name, transcribe.transcribe(path, speakers), True
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / name
            path.write_bytes(raw)
            return name, transcribe.transcribe(path, speakers), True
    if not lower.endswith(TEXT_TYPES):
        raise ValueError(f'{name}: send a recording ({", ".join(transcribe.AUDIO_TYPES)}) '
                         f'or a text transcript ({", ".join(TEXT_TYPES)})')
    text = path.read_text(encoding='utf-8', errors='replace') if path else raw.decode('utf-8', errors='replace')
    return name, clean(text), False
