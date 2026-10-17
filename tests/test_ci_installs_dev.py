"""The pre-push gate for build.yml's dev-dependency installs (tools/ci-installs-dev.py): today's build.yml passes (its replay-install step is
runtime-only on purpose), a test job that drops dev dependencies fails, and so does the same line in any other step."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import importlib.util
spec = importlib.util.spec_from_file_location('ci_installs_dev', ROOT / 'tools' / 'ci-installs-dev.py')
gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)

REPLAY = """      - name: Install the replays' packages and browser
        id: replay-install
        run: |
          (cd desktop && (npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts))
"""


class CiInstallsDevTest(unittest.TestCase):
    def test_todays_build_yml_passes(self):
        result = subprocess.run([sys.executable, str(ROOT / 'tools' / 'ci-installs-dev.py'), str(ROOT / '.github' / 'workflows' / 'build.yml')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_the_replay_step_alone_is_exempt(self):
        self.assertEqual(gate.offending(REPLAY), [])
        # the old rule (any --omit=dev) flags it
        self.assertTrue(gate.BAD.search(REPLAY))

    def test_a_test_job_without_dev_dependencies_fails(self):
        for flag in ('--omit=dev', '--only=prod', '--production'):
            text = f"      - name: Desktop tests\n        run: |\n          (cd desktop && npm ci {flag})\n" + REPLAY
            self.assertEqual(len(gate.offending(text)), 1, flag)
            # also when it follows the exempt step
            self.assertEqual(len(gate.offending(REPLAY + text)), 1, flag)


if __name__ == '__main__':
    unittest.main()
