"""The shared release checks wait for a running build.yml on the commit instead of failing, and every release job goes through them."""
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools' / 'release-checks.sh'

# A fake `gh`: `run list ... --json status` answers the open-run count from a script (one entry per call, the last repeats), the completed list answers a fixed verdict.
FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
state = os.environ['FAKE_STATE']
args = sys.argv[1:]
if args[:2] == ['run', 'list']:
    if '--jq' in args:
        counts = json.load(open(os.path.join(state, 'open.json')))
        n = int(open(os.path.join(state, 'calls')).read() or 0) if os.path.exists(os.path.join(state, 'calls')) else 0
        open(os.path.join(state, 'calls'), 'w').write(str(n + 1))
        print(counts[min(n, len(counts) - 1)])
    else:
        print(json.dumps([{'conclusion': c} for c in json.load(open(os.path.join(state, 'done.json')))]))
    sys.exit(0)
sys.exit(1)
'''


class ReleaseChecks(unittest.TestCase):
    def run_checks(self, open_counts, done, wait='5'):
        with tempfile.TemporaryDirectory() as tmp:
            bin_dir = Path(tmp) / 'bin'
            bin_dir.mkdir()
            gh = bin_dir / 'gh'
            gh.write_text(FAKE_GH)
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            (Path(tmp) / 'open.json').write_text(json.dumps(open_counts))
            (Path(tmp) / 'done.json').write_text(json.dumps(done))
            env = dict(os.environ, PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', FAKE_STATE=tmp, RELEASE_CI_POLL='1', RELEASE_CI_WAIT=wait, GITHUB_REPOSITORY='o/r')
            env.pop('JOB_PILOTTO_SOAK', None)
            done_run = subprocess.run(['bash', str(SCRIPT), 'desktop-v9', 'b5c13d0c2abf3574fe01a8f2ecff527eaf485965'], env=env, capture_output=True, text=True, timeout=60)
            return done_run.returncode, done_run.stdout

    def test_a_running_build_is_waited_for_then_decides(self):
        code, out = self.run_checks([1, 1, 0], ['success'])
        self.assertEqual(code, 0, out)
        self.assertIn('build.yml on b5c13d0: green', out)

    def test_a_build_that_ends_red_stops_the_release(self):
        code, out = self.run_checks([1, 0], ['failure'])
        self.assertEqual(code, 1, out)
        self.assertIn('stays a pre-release', out)

    def test_a_build_still_running_after_the_wait_stops_the_release_and_says_so(self):
        code, out = self.run_checks([1], [], wait='2')
        self.assertEqual(code, 1, out)
        self.assertIn('is still running after', out)
        self.assertIn('stays a pre-release', out)

    def test_every_release_job_goes_through_the_shared_checks(self):
        # The jobs that approve a beta (Mac, Windows/Linux in desktop.yml, beta-approve.yml) read build.yml's result only through tools/release-checks.sh.
        callers = ['desktop.yml', 'beta-approve.yml']
        for name in callers:
            text = (ROOT / '.github' / 'workflows' / name).read_text()
            self.assertIn('tools/release-checks.sh "$TAG" "$REF"', text, name)
        for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
            if path.name == 'build.yml':
                continue
            self.assertIsNone(re.search(r'--workflow[ =]build\.yml', path.read_text()), f'{path.name} reads build.yml itself: use tools/release-checks.sh')
        self.assertEqual(len(re.findall(r'tools/release-checks\.sh', (ROOT / '.github' / 'workflows' / 'desktop.yml').read_text())), 2)


if __name__ == '__main__':
    unittest.main()
