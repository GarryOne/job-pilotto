"""⏱️ Search runs as the one run history: a row from start (Running) to end, with the result and the log."""
import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src import telegram
from src.notion import cron_runs


class FakeTracker:
    def __init__(self):
        self.calls = []

    def _request(self, method, path, body=None):
        self.calls.append((method, path, body))
        return {'id': 'row-1', 'url': 'https://notion.so/row-1'} if method == 'POST' else {}


class RunHistoryTest(unittest.TestCase):
    def setUp(self):
        cron_runs._open.clear()
        cron_runs._auto.clear()
        cron_runs._output.clear()
        telegram.MESSAGES.clear()
        self.db = mock.patch.object(cron_runs, 'CRON_RUNS_DATABASE_ID', 'runs-db')
        self.db.start()

    def tearDown(self):
        self.db.stop()
        cron_runs._open.clear()
        cron_runs._auto.clear()

    def test_the_row_opens_as_running_and_the_end_fills_it_with_the_result_and_log(self):
        tracker = FakeTracker()
        cron_runs.auto_begin(tracker)
        with redirect_stdout(io.StringIO()) as out:
            run = cron_runs.new_run('insight')
            print('Reading the market')
            telegram.to_app('💡 <b>Skills</b>\nGo is in 40% of your matches &amp; rising')
            run['headline'] = 'Insight sent: Skills — Go is in 40% of your matches'
            url = cron_runs.log_run(tracker, run)
        self.assertEqual(url, 'https://notion.so/row-1')
        self.assertIn('Cronjob run logged: https://notion.so/row-1', out.getvalue())
        (method, path, body), *rest = tracker.calls
        self.assertEqual((method, path), ('POST', 'pages'))
        self.assertEqual(body['properties']['Status'], {'select': {'name': 'Running'}})
        self.assertNotIn('children', body)
        updates = [call for call in rest if call[0] == 'PATCH']
        props = next(b for m, p, b in updates if p == 'pages/row-1' and 'Status' in b['properties'])['properties']
        self.assertEqual(props['Status'], {'select': {'name': 'OK'}})
        self.assertTrue(props['Summary']['rich_text'][0]['text']['content'].startswith('Insight sent: Skills'))
        blocks = next(b for m, p, b in updates if p == 'blocks/row-1/children')['children']
        texts = [blk[blk['type']]['rich_text'][0]['text']['content'] for blk in blocks]
        self.assertIn('Result', texts)
        self.assertIn('Go is in 40% of your matches & rising', texts)  # plain text, entities decoded
        log = blocks[-1]
        self.assertEqual(log['type'], 'toggle')
        self.assertIn('Reading the market', log['toggle']['children'][0]['code']['rich_text'][0]['text']['content'])

    def test_a_job_that_ends_before_its_report_is_marked_failed_not_left_running(self):
        tracker = FakeTracker()
        cron_runs.auto_begin(tracker)
        with redirect_stdout(io.StringIO()):
            cron_runs.new_run('weekly')
            cron_runs._unfinished()
        status = [b['properties']['Status'] for m, p, b in tracker.calls if m == 'PATCH' and p == 'pages/row-1']
        self.assertEqual(status, [{'select': {'name': 'Failed'}}])

    def test_modes_that_never_log_open_no_row(self):
        tracker = FakeTracker()
        cron_runs.auto_begin(tracker)
        with redirect_stdout(io.StringIO()):
            cron_runs.new_run('more')
        self.assertEqual(tracker.calls, [])

    def test_progress_updates_the_summary_at_most_every_few_seconds(self):
        tracker = FakeTracker()
        cron_runs._open.update(tracker=tracker, id='row-1', url='u', run={'mode': 'scheduled'})
        cron_runs._last_step['at'] = 0.0
        cron_runs._progress('Scoring 12 new jobs')
        cron_runs._progress('Scoring 13 new jobs')  # too soon: skipped
        cron_runs._progress('Warning: x')
        self.assertEqual([b['properties']['Summary']['rich_text'][0]['text']['content'] for _, _, b in tracker.calls],
                         ['⏳ Scoring 12 new jobs'])


if __name__ == '__main__':
    unittest.main()
