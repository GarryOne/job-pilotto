"""The folders moved to ~/jobadabra, ~/jobadabra-web, ~/jobadabra-lab on 24 Oct 2026: no doc or tool names the old paths or repos."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD = 'job-' + 'pilotto'
# An old folder or repo name: the old home folders, the old /Users/mac path, or the bare old private repo names.
PATTERN = re.compile(rf'(?:~|/Users/mac)/{OLD}(?:-site|-internal)?(?![\w-])|(?<![\w./-]){OLD}-(?:site|internal)(?![\w-])')
# History (dated specs, recorded pages), the tools that still find the old folder during the symlink weeks, and the guards that name both.
ALLOWED = ('docs/superpowers/specs/', 'desktop/e2e/ladder-fixtures/', 'tools/auto-pull.sh', 'tools/apply-batch-claude.sh',
           'tools/pr-red-check.sh', 'tests/test_no_business_docs.py')


class LocalPathTests(unittest.TestCase):
    def test_no_file_names_the_old_folders_or_repos(self):
        files = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\n')
        hits = []
        for name in files:
            if not name or name.startswith(ALLOWED):
                continue
            try:
                text = (ROOT / name).read_text(encoding='utf-8')
            except (UnicodeDecodeError, OSError):
                continue
            hits += [f'{name}:{n}' for n, line in enumerate(text.split('\n'), 1) if PATTERN.search(line)]
        self.assertEqual(hits, [], 'say ~/jobadabra, ~/jobadabra-web, ~/jobadabra-lab (the old paths are symlinks only until ~7 Nov 2026)')


if __name__ == '__main__':
    unittest.main()
