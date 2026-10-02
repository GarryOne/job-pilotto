"""docs/HOW-IT-RUNS.md lists every workflow, so a new session sees every automatic loop (and the page can't go stale)."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class HowItRunsTest(unittest.TestCase):
    def test_every_workflow_is_listed(self):
        page = (ROOT / 'docs' / 'HOW-IT-RUNS.md').read_text(encoding='utf-8')
        missing = [f.name for f in sorted((ROOT / '.github' / 'workflows').glob('*.yml')) if f'`{f.name}`' not in page]
        self.assertEqual(missing, [], f'Add these workflows to docs/HOW-IT-RUNS.md (the loops table): {missing}')

    def test_central_scout_and_employer_index_are_documented(self):
        page = (ROOT / 'docs' / 'HOW-IT-RUNS.md').read_text(encoding='utf-8')
        for needle in ('`central-scout.yml`', 'GarryOne/job-pilotto-internal', '/api/index', 'INDEX_PUBLISH_KEY'):
            self.assertIn(needle, page)
        row = next(line for line in page.splitlines() if line.startswith('| `scout.yml`'))
        self.assertIn('optional', row)   # a user's own scout is optional now
        self.assertIn('employer index', (ROOT / 'CLAUDE.md').read_text(encoding='utf-8').lower())

    def test_claude_md_points_to_it(self):
        self.assertIn('docs/HOW-IT-RUNS.md', (ROOT / 'CLAUDE.md').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
