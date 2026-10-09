"""Every engine module can be the first one imported (9 Oct 2026: board_ideas imported the split-out visits_jobpages before visits, and every
daily search on Windows died on a circular import; the tests had imported visits first and hid it). One child process; before each module
it forgets every src module so that one loads first."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = r'''
import importlib, pathlib, subprocess, sys, traceback
failed = []
# The modules git tracks, not every file on disk: another test may plant a temporary module in src/ while this runs in a parallel shard
# (9 Oct 2026: test_affected_tests' src/zz_orphan_... turned main red, run 37930166345).
tracked = subprocess.run(['git', 'ls-files', 'src'], capture_output=True, text=True).stdout.split()
for path in sorted(pathlib.Path(name) for name in tracked if name.endswith('.py')):
    name = '.'.join(path.with_suffix('').parts)
    if name.endswith('__main__') or name.endswith('_main_'):
        continue
    for loaded in [m for m in sys.modules if m == 'src' or m.startswith('src.')]:
        del sys.modules[loaded]
    try:
        importlib.import_module(name.removesuffix('.__init__'))
    except Exception:
        failed.append(name + ': ' + traceback.format_exc().strip().splitlines()[-1])
print('\n'.join(failed))
'''


class ImportFirst(unittest.TestCase):
    def test_every_module_imports_on_its_own(self):
        done = subprocess.run([sys.executable, '-c', CHECK], cwd=ROOT, capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr[-2000:])
        self.assertEqual(done.stdout.strip(), '', 'modules that fail when imported first:\n' + done.stdout)


if __name__ == '__main__':
    unittest.main()
