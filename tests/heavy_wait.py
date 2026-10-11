"""Helper of the heavy-lock tests (not a test module): wait until n runs are in the lock's books (holding a slot or queued), instead of a fixed gap that a loaded Mac outruns."""
import time
from pathlib import Path


def registered(heavy_dir):
    root = Path(heavy_dir)
    slots = [p for p in root.glob('lock*') if p.is_dir()]
    queued = list((root / 'queue').glob('*')) if (root / 'queue').is_dir() else []
    return len(slots) + len(queued)


def wait_registered(heavy_dir, n, timeout=30):
    deadline = time.monotonic() + timeout
    while registered(heavy_dir) < n and time.monotonic() < deadline:
        time.sleep(0.05)
