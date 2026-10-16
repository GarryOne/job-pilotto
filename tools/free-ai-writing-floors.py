"""Applies the code floors (src/ai/writing_floors.py) to a draft read from stdin, for the writing eval: {"feature": "letter"|"prep"|"rejection", "kit": {...}, "ground": "..."} -> the draft after the floors, as JSON."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai.writing_floors import kit_floors, scrub  # noqa: E402

payload = json.load(sys.stdin)
draft = kit_floors(payload['kit'], payload['ground']) if payload['feature'] == 'letter' else scrub(payload['kit'], payload['ground'])[0]
print(json.dumps(draft, ensure_ascii=False))
