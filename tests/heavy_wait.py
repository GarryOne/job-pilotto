"""Helper of the heavy-lock tests (not a test module): wait until n runs are in the lock's books (holding a slot or queued), instead of a fixed gap that a loaded Mac outruns."""
import time
from pathlib import Path


def _pid(path):
    """The pid a slot or a ticket names (first word of its first line; a slot's pid file is just the pid), else the file's own name while it is still being written."""
    try:
        words = Path(path).read_text().split()
    except OSError:
        return None
    return words[0] if words else Path(path).name


def registered(heavy_dir):
    """Runs in the lock's books: one per pid. A run that took its slot still has its ticket for a moment, so counting files counted it twice and a test went on before its next run had started."""
    root = Path(heavy_dir)
    runs = {_pid(p / 'pid') or p.name for p in root.glob('lock*') if p.is_dir()}
    runs |= {_pid(p) for p in (root / 'queue').glob('*')} if (root / 'queue').is_dir() else set()
    return len(runs - {None})


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
