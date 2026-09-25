import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import apply_batch

KIT = {'url': 'https://example.test/job/1', 'cover_letter': 'Dear team...',
       'answers': [{'question': 'Why us?', 'answer': 'Because.'}, {'question': 'Blank?', 'answer': ''}],
       'check_before_sending': ['Confirm salary expectation', 'Confirm sponsorship answer']}

ROW = {'id': 'page-1', 'properties': {'Job': {'title': [{'plain_text': 'SRE'}]},
                                      'Company': {'rich_text': [{'plain_text': 'Acme'}]}}}


class FakeTracker:
    database_id = 'db'

    def __init__(self, pairs):
        self._pairs = pairs
        self.marked = []

    def query_database(self, database_id, filter_):
        return [row for row, _ in self._pairs]

    def read_kit(self, page_id, heading):
        for row, kit_data in self._pairs:
            if row['id'] == page_id:
                return kit_data
        return None

    def mark(self, job, stage):
        self.marked.append((job['url'], stage))
        return {'id': 'x'}, 'updated'


class BuildPromptTests(unittest.TestCase):
    def test_skips_blank_answers_and_includes_cover_letter_and_cv(self):
        prompt = apply_batch.build_prompt(KIT, '/tmp/cv.pdf')
        self.assertIn('Dear team...', prompt)
        self.assertIn('Why us?: Because.', prompt)
        self.assertNotIn('Blank?', prompt)
        self.assertIn('/tmp/cv.pdf', prompt)
        self.assertIn(KIT['url'], prompt)


class DryRunOutputTests(unittest.TestCase):
    def test_dry_run_prints_check_before_sending_per_job_and_in_summary(self):
        tracker = FakeTracker([(ROW, KIT)])
        out = io.StringIO()
        with redirect_stdout(out):
            pairs = apply_batch.ready_jobs(tracker, 5)
            for row, kit_data in pairs:
                print(f"--- {apply_batch._title(row)} ---")
                if kit_data.get('check_before_sending'):
                    print('⚠️  Check before sending:')
                    for item in kit_data['check_before_sending']:
                        print(f'   • {item}')
        text = out.getvalue()
        self.assertIn('Confirm salary expectation', text)
        self.assertIn('Confirm sponsorship answer', text)
        self.assertEqual(tracker.marked, [])  # dry-run style path never marks Applying


if __name__ == '__main__':
    unittest.main()
