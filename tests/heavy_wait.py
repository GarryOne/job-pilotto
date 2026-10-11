"""Helper of the heavy-lock tests (not a test module): wait until n runs are in the lock's books (holding a slot or queued), instead of a fixed gap that a loaded Mac outruns."""
import time
from pathlib import Path


def registered(heavy_dir):
    root = Path(heavy_dir)
    slots = [p for p in root.glob('lock*') if p.is_dir()]
    queued = list((root / 'queue').glob('*')) if (root / 'queue').is_dir() else []
    return len(slots) + len(queued)


def wait_registered(heavy_dir, n, timeout=90):
    deadline = time.monotonic() + timeout
    while registered(heavy_dir) < n and time.monotonic() < deadline:
        time.sleep(0.1)
    assert registered(heavy_dir) >= n, f'only {registered(heavy_dir)} of {n} runs are in the lock\'s books after {timeout}s'


def gated(trace, name, gate_dir):
    """A run body that logs "+name", waits until the test releases it (a file gate_dir/<name>, or gate_dir/all), logs "-name": no fixed naps, so the test takes as long as the lock needs."""
    gate = Path(gate_dir).as_posix()
    return f'echo +{name} >> {Path(trace).as_posix()}; while [ ! -f {gate}/{name} ] && [ ! -f {gate}/all ]; do sleep 0.1; done; echo -{name} >> {Path(trace).as_posix()}'


def release(gate_dir, *names):
    Path(gate_dir).mkdir(parents=True, exist_ok=True)
    for name in names or ('all',):
        (Path(gate_dir) / name).write_text('go')


def wait_trace(trace, n, timeout=90):
    """Wait until the trace has n words (starts and ends)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if len(Path(trace).read_text().split()) >= n:
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise AssertionError(f'the trace has fewer than {n} words after {timeout}s: {Path(trace).read_text().split() if Path(trace).exists() else None}')
