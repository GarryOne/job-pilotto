"""The promote guard in tools/release-stable.sh: a release may only become stable when the Windows installer it
carries is the one its own build made.

When the windows job fails, desktop.yml's mac-only fallback uploads the *previous* release's generic
Job-Pilotto-windows-x64.exe, so the release looks promotable while its Windows app is an older version (30 Sep 2026:
alpha.131-133 shipped that way, and RELEASE.md §2 warns about it). A generic filename alone proves nothing; the
versioned installer beside it, the same bytes, does.

Driven with a fake `gh` on PATH: no network, no release touched.
"""
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'release-stable.sh'
TAG = 'desktop-v0.4.0-alpha.143'
OWN = f'Job-Pilotto-{TAG.removeprefix("desktop-v")}-x64.exe'
GENERIC = 'Job-Pilotto-windows-x64.exe'
DMG = f'Job-Pilotto-{TAG.removeprefix("desktop-v")}-arm64.dmg'

FAKE_GH = textwrap.dedent('''\
    #!/usr/bin/env bash
    if [ "$1" = release ] && [ "$2" = view ]; then printf '%s\\n' "${FAKE_ASSETS:-}"; exit 0; fi
    if [ "$1" = release ] && [ "$2" = edit ]; then echo "edited $3"; exit 0; fi
    echo "fake gh: unexpected $*" >&2; exit 1
    ''')


class PromoteGuardTests(unittest.TestCase):
    def promote(self, assets):
        """Run the real script against these (name, size) assets, with a fake gh standing in for GitHub."""
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / 'gh'
            binary.write_text(FAKE_GH)
            binary.chmod(0o755)
            env = {**os.environ, 'PATH': f'{folder}{os.pathsep}{os.environ["PATH"]}',
                   'FAKE_ASSETS': '\n'.join(f'{name}\t{size}' for name, size in assets)}
            return subprocess.run(['bash', str(SCRIPT), TAG], capture_output=True, text=True, env=env, timeout=60)

    def test_its_own_installer_at_the_same_size_promotes(self):
        done = self.promote([(OWN, 191850045), (GENERIC, 191850045)])
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('Stable:', done.stdout)

    def test_a_carried_over_installer_is_refused(self):
        # The mac-only fallback: the previous release's .exe under the generic name, nothing versioned.
        done = self.promote([(DMG, 197596581), (GENERIC, 191848238)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('carries no installer of its own', done.stderr)

    def test_an_installer_of_another_size_is_refused(self):
        done = self.promote([(OWN, 191850045), (GENERIC, 191848238)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('is not the one its build made', done.stderr)

    def test_a_release_with_no_windows_installer_waits(self):
        done = self.promote([(DMG, 197596581)])
        self.assertEqual(done.returncode, 1)
        self.assertIn('no Windows installer yet', done.stderr)


if __name__ == '__main__':
    unittest.main()
