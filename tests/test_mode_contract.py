"""Every daily mode the app can start is listed where it runs: the engine, the public workflow and the Always-on template.

A mode missing from the workflow's `options:` is refused by GitHub at dispatch time, so Always on breaks for that one button
only (Prepare top matches, 5 Oct 2026, was the case this guards)."""
import re
import unittest

from src import daily
from src.notion import cron_runs
from src.paths import ROOT as REPO

# Run on the Mac only (the app waits for the answer: "Applied elsewhere" → Add a job), never dispatched to GitHub.
LOCAL_ONLY = {'import'}


def options(path):
    text = (REPO / path).read_text()
    return set(re.search(r'options: \[([^\]]*)\]', text).group(1).replace(' ', '').split(','))


class ModeContract(unittest.TestCase):
    def test_workflow_and_template_offer_the_same_modes_as_the_engine(self):
        engine = set(daily.MODES) - LOCAL_ONLY
        for path in ('.github/workflows/daily.yml', 'templates/github-actions/daily.yml'):
            with self.subTest(path):
                offered = options(path)
                self.assertEqual(engine - offered, set(), f'{path} cannot dispatch these modes')
                self.assertEqual(offered - engine, set(), f'{path} offers modes the engine rejects')

    def test_every_mode_that_writes_a_run_row_is_a_known_notion_option(self):
        import json
        schema = json.loads((REPO / 'config' / 'notion_schema.json').read_text())
        text = json.dumps(schema)
        for mode in daily.MODES:
            if mode in cron_runs.LOGGED_MODES:
                self.assertIn(f'"name": "{mode}"', text, f'Mode "{mode}" is not a select option of ⏱️ Search runs')


if __name__ == '__main__':
    unittest.main()
