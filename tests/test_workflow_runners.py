"""Every Linux job names its Ubuntu version: `ubuntu-latest` moves to a new release on GitHub's date (Ubuntu 26 from 19 Oct 2026), with a notice on every
job until then and, after, a new system under the e2e suites (Electron, xvfb) in the middle of whatever release is going out. The move is ours to make,
in one change that bumps the version below everywhere and is checked by an e2e run.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [*sorted((ROOT / '.github' / 'workflows').glob('*.yml')), ROOT / 'desktop' / 'e2e' / 'lib' / 'plan.mjs']


class PinnedRunners(unittest.TestCase):
    def test_no_job_runs_on_ubuntu_latest(self):
        found = [f'{path.name}:{number}' for path in FILES for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1)
                 if re.search(r'ubuntu-latest', line)]
        self.assertEqual(found, [], 'name the Ubuntu version (ubuntu-24.04) instead of ubuntu-latest')


if __name__ == '__main__':
    unittest.main()
