"""Every workflow gets its Playwright browser through the shared action (cached, a stalled mirror cut), never a bare `playwright install`.

24 Oct 2026: the Chromium step took 18-28 s, but 3 of 40 runs took 5-8 min: Ubuntu's mirror crawled at 72 kB/s while apt fetched the browser's system
libraries. The action keeps browser and packages in the GitHub cache, cuts a stalled download and retries.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
ACTION = ROOT / '.github' / 'actions' / 'playwright-browser'


class PlaywrightInstallAction(unittest.TestCase):
    def test_no_workflow_installs_playwright_by_hand(self):
        bare = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                if re.search(r'playwright\s+install', line) and not line.lstrip().startswith('#'):
                    bare.append(f'{path.name}:{number}')
        self.assertEqual(bare, [], 'use ./.github/actions/playwright-browser instead of `playwright install`: ' + ', '.join(bare))

    def test_the_action_caches_by_exact_version_and_cuts_a_stall(self):
        action = (ACTION / 'action.yml').read_text(encoding='utf-8')
        script = (ACTION / 'install.sh').read_text(encoding='utf-8')
        self.assertIn('~/.cache/ms-playwright', action)
        self.assertNotIn('restore-keys', action, 'a cache must never serve another Playwright version\'s browser')
        self.assertIn('/var/cache/pw-apt', action)
        self.assertRegex(script, r'timeout "\$secs"')
        self.assertIn('--no-shell', script)

    def test_callers_pass_a_known_mode_and_runtime(self):
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            for block in re.findall(r'uses: \./\.github/actions/playwright-browser\n\s+with:(.*?)(?=\n\s+- |\n\S|\Z)', text, re.S):
                for mode in re.findall(r'mode:\s*(\w+)', block):
                    self.assertIn(mode, ('full', 'shell', 'both'), path.name)
                for runtime in re.findall(r'runtime:\s*(\w+)', block):
                    self.assertIn(runtime, ('node', 'python'), path.name)


if __name__ == '__main__':
    unittest.main()
