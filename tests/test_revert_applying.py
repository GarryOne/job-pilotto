"""A session that ended without a submission puts its job back from Applying to Kit ready, and only from Applying."""
import unittest

from src.notion.client import Tracker


class Recorder(Tracker):
    def __init__(self, stage):
        self.stage, self.requests = stage, []

    def find(self, url):
        return {'id': 'page-1', 'properties': {'Stage': {'select': {'name': self.stage} if self.stage else None}}}

    def _request(self, method, path, body=None):
        self.requests.append((method, path, body))


class RevertApplyingTest(unittest.TestCase):
    def test_applying_goes_back_to_kit_ready(self):
        tracker = Recorder('Applying')
        self.assertEqual(tracker.revert_applying('https://jobs.test/1'), 'updated')
        self.assertEqual(tracker.requests, [('PATCH', 'pages/page-1', {'properties': {'Stage': {'select': {'name': 'Kit ready'}}}})])

    def test_any_other_stage_is_left_alone(self):
        for stage in ('Applied', 'Interviewing', 'Rejected', 'Kit ready', 'Saved', None):
            tracker = Recorder(stage)
            self.assertEqual(tracker.revert_applying('https://jobs.test/1'), 'unchanged', stage)
            self.assertEqual(tracker.requests, [], stage)

    def test_a_job_that_is_not_in_notion_is_left_alone(self):
        tracker = Recorder('Applying')
        tracker.find = lambda url: None
        self.assertEqual(tracker.revert_applying('https://jobs.test/none'), 'unchanged')


if __name__ == '__main__':
    unittest.main()
