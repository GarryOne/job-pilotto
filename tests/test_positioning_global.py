"""Fails when a user-facing file pitches the product as tech-only again (owner, 19 Oct 2026: a global job search, across Europe)."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['README.md', 'desktop/package.json', 'extension/manifest.json', 'desktop/renderer/index.html',
         'site/public/index.html', 'site/public/friends.html', 'site/public/compare.html',
         'site/public/intelligence.html', 'site/public/platforms.html', 'site/public/pricing.html']
# A tech-only pitch: the product is for tech/IT/engineering jobs. One example role among many is fine (the board's STAFF SRE row).
PITCH = re.compile(
    r'finds (the right )?tech jobs|\btech jobs that fit|for IT, software|IT, software and engineering'
    r'|focuses on IT|for tech today|(automation|search|app) for (SRE|platform|DevOps)', re.I)


class PositioningGlobal(unittest.TestCase):
    def test_no_tech_only_pitch_in_user_facing_files(self):
        hits = []
        for name in FILES:
            path = ROOT / name
            if not path.exists():
                continue
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                if PITCH.search(line):
                    hits.append(f'{name}:{number}: {line.strip()[:120]}')
        self.assertEqual(hits, [], 'product pitched as tech-only: say "any role across Europe"')

    def test_pattern_catches_the_old_wording(self):
        for old in ('finds the right tech jobs, drafts', 'For IT, software and engineering jobs',
                    'Job-search automation for SRE / platform / DevOps roles.', 'focuses on IT, software'):
            self.assertTrue(PITCH.search(old), old)


if __name__ == '__main__':
    unittest.main()
