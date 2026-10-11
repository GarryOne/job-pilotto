"""The push gate runs its seconds-long commit-message checks before the minutes-long journey and ladder gates, so a missing trailer fails fast."""
# 11 Oct 2026: a missing "Rung:" line was reported only after a 255 s journey gate, three times in one landing.
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATE = (ROOT / 'tools' / 'pre-push-check.sh').read_text()


class GateOrderTest(unittest.TestCase):
    def test_cheap_checks_run_before_the_slow_gates(self):
        slow = min(GATE.index('timed "journey gate"'), GATE.index('timed "ladder gate"'))
        for cheap in ('timed "file size"', 'timed "recorded cases"', 'timed "rung trailer"', 'timed "e2e issue links"'):
            self.assertLess(GATE.index(cheap), slow, f'{cheap} must run before the journey and ladder gates')


    def test_the_slow_gates_reuse_a_pass_on_the_same_tree(self):
        for gate in ('"journey gate" gate_cache_run "$repo" journey-gate', '"ladder gate" gate_cache_run "$repo" ladder-gate'):
            self.assertIn(gate, GATE, 'a retry that only changed a commit message must not re-run a slow gate')

    def test_both_slow_gates_key_their_pass_on_the_files_they_read_and_those_cover_the_flow_files(self):
        # owner, 11 Oct 2026: a refused push (main moved) re-ran ~10 min of gates after a rebase over commits that touched none of their files
        for gate in ('GATE_CACHE_PATHS="$gate_paths" timed "journey gate"', 'GATE_CACHE_PATHS="$gate_paths" timed "ladder gate"'):
            self.assertIn(gate, GATE)
        paths = re.search(r'^gate_paths="([^"]+)"', GATE, re.M).group(1).split()
        self.assertTrue(paths)
        if not shutil.which('node'):
            self.skipTest('needs node')
        flows = subprocess.run(['node', '-e', "import('./desktop/e2e/flows.mjs').then(m => console.log(JSON.stringify([...m.FLOW_FILES, ...m.JOURNEY_TESTS.map(t => 'desktop/' + t), 'desktop/test/ladder-ratchet.test.js', 'desktop/e2e/ladder-baseline.json'])))"],
                               cwd=ROOT, capture_output=True, text=True, check=True).stdout
        import json
        for file in json.loads(flows):
            self.assertTrue(any(file == path or file.startswith(path.rstrip('/') + '/') for path in paths), f'{file} is read by the journey/ladder gate but is not in gate_paths')


if __name__ == '__main__':
    unittest.main()
