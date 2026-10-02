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
    if [ "$1" = api ]; then echo abc1234def5678; exit 0; fi
    if [ "$1" = workflow ] && [ "$2" = run ]; then echo "$*" >> "$FAKE_LOG"; touch "$FAKE_STARTED"; exit 0; fi
    if [ "$1" = run ] && [ "$2" = watch ]; then echo "watched $3" >> "$FAKE_LOG"; exit 0; fi
    if [ "$1" = run ] && [ "$2" = list ]; then
      now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      case "$*" in
        *--event*) echo 4242; exit 0 ;;   # "which run did I just start" (the script's -q picks the id)
      esac
      state="${FAKE_E2E:-green}"
      [ -e "$FAKE_STARTED" ] && state="${FAKE_E2E_AFTER:-green}"
      case "$state" in
        green) printf '[{"conclusion":"success","headSha":"abc1234def5678","createdAt":"%s"}]' "$now" ;;
        red) printf '[{"conclusion":"failure","headSha":"abc1234def5678","createdAt":"%s"}]' "$now" ;;
        other) printf '[{"conclusion":"success","headSha":"fff0000aaaa","createdAt":"%s"}]' "$now" ;;
        stale) echo '[{"conclusion":"success","headSha":"abc1234def5678","createdAt":"2020-01-01T00:00:00Z"}]' ;;
        none) echo '[]' ;;
      esac
      exit 0
    fi
    echo "fake gh: unexpected $*" >&2; exit 1
    ''')


class PromoteGuardTests(unittest.TestCase):
    def promote(self, assets, e2e='green', skip=False, after='green', no_start=False):
        """Run the real script against these (name, size) assets, with a fake gh standing in for GitHub."""
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / 'gh'
            binary.write_text(FAKE_GH)
            binary.chmod(0o755)
            self.log = Path(folder) / 'gh.log'
            env = {**os.environ, 'PATH': f'{folder}{os.pathsep}{os.environ["PATH"]}', 'FAKE_LOG': str(self.log), 'FAKE_STARTED': str(Path(folder) / 'started'),
                   'FAKE_ASSETS': '\n'.join(f'{name}\t{size}' for name, size in assets), 'FAKE_E2E': e2e, 'FAKE_E2E_AFTER': after, 'E2E_POLL_SECONDS': '0',
                   **({'SKIP_E2E': '1'} if skip else {}), **({'E2E_NO_START': '1'} if no_start else {})}
            done = subprocess.run(['bash', str(SCRIPT), TAG], capture_output=True, text=True, env=env, timeout=60)
            self.calls = self.log.read_text() if self.log.exists() else ''
            return done

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


    def test_a_green_end_to_end_run_lets_the_build_through(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='green')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('End-to-end journey: green', done.stdout)

    def test_a_red_end_to_end_run_stops_the_promotion(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='red')
        self.assertEqual(done.returncode, 1)
        self.assertIn('is RED', done.stderr)
        self.assertNotIn('Stable:', done.stdout)

    def test_without_the_right_to_start_a_run_none_or_an_old_one_stops_it(self):
        # The canary auto-promote (E2E_NO_START=1) cannot start a run: it waits for the schedule's.
        for state, words in (('none', 'No finished end-to-end run'), ('stale', 'over two days old')):
            done = self.promote([(OWN, 1), (GENERIC, 1)], e2e=state, no_start=True)
            self.assertEqual(done.returncode, 1, state)
            self.assertIn(words, done.stderr)
            self.assertEqual(self.calls, '', 'it started nothing')

    def test_a_run_of_another_commit_does_not_vouch_for_this_build(self):
        # A human promotion needs THIS build's commit tested: the script starts a run on the tag, waits, and decides by it.
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='other', after='green')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('--ref ' + TAG, self.calls)
        self.assertIn('watched 4242', self.calls)
        self.assertIn('End-to-end journey: green', done.stdout)

    def test_the_run_it_started_decides_and_a_red_one_stops_the_promotion(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='stale', after='red')
        self.assertEqual(done.returncode, 1)
        self.assertIn('is RED', done.stderr)
        self.assertNotIn('Stable:', done.stdout)

    def test_a_green_run_of_the_commit_starts_nothing(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='green')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.calls, '')

    def test_no_start_accepts_the_latest_run_on_main_as_before(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='other', no_start=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.calls, '')

    def test_skip_e2e_promotes_anyway_for_a_hotfix(self):
        done = self.promote([(OWN, 1), (GENERIC, 1)], e2e='red', skip=True)
        self.assertEqual(done.returncode, 0, done.stderr)


if __name__ == '__main__':
    unittest.main()
