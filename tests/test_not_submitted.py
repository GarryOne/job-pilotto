"""An "Applied" the extension inferred on its own can be undone by the owner: back to Applying, and the false
📈 Applied event goes with it. Only a bare Applied — a stage with the employer's own evidence behind it is left to
them (1 Oct 2026: a job was marked Applied while its form sat open, unsubmitted)."""
import unittest

from src.notion.client import Tracker
from src.notion.ledger import archive_events


class Recorder(Tracker):
    def __init__(self, stage, events=()):
        self.stage, self.requests, self.events = stage, [], list(events)

    def find(self, url):
        return {'id': 'page-1', 'properties': {'Stage': {'select': {'name': self.stage} if self.stage else None},
                                               'Company': {'rich_text': [{'plain_text': 'Anthropic'}]}}}

    def _request(self, method, path, body=None):
        self.requests.append((method, path, body))
        return {}

    def query_database(self, db, filter):  # what events_of() calls
        return self.events


def event(event_id, kind, page_id='page-1'):
    return {'id': event_id, 'properties': {'Kind': {'select': {'name': kind}}, 'Application': {'relation': [{'id': page_id}]}}}


class NotSubmittedTest(unittest.TestCase):
    def test_applied_goes_back_to_applying_and_clears_the_date(self):
        tracker = Recorder('Applied')
        outcome, page = tracker.revert_unsubmitted('https://jobs.test/1')
        self.assertEqual(outcome, 'updated')
        self.assertEqual(tracker.requests, [('PATCH', 'pages/page-1', {'properties': {
            'Stage': {'select': {'name': 'Applying'}}, 'Applied on': {'date': None}}})])
        self.assertEqual(page['id'], 'page-1')

    def test_a_stage_with_evidence_behind_it_is_left_alone(self):
        for stage in ('Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer', 'Rejected'):
            tracker = Recorder(stage)
            outcome, page = tracker.revert_unsubmitted('https://jobs.test/1')
            self.assertEqual((outcome, tracker.requests), ('past', []), stage)
            self.assertEqual(page['id'], 'page-1')

    def test_anything_else_is_unchanged(self):
        for stage in ('Kit ready', 'Applying', 'Saved', 'Dismissed', None):
            tracker = Recorder(stage)
            self.assertEqual(tracker.revert_unsubmitted('https://jobs.test/1')[0], 'unchanged', stage)
            self.assertEqual(tracker.requests, [], stage)
        tracker = Recorder('Applied')
        tracker.find = lambda url: None
        self.assertEqual(tracker.revert_unsubmitted('https://jobs.test/none')[0], 'unchanged')

    def test_the_false_applied_event_is_trashed_and_other_kinds_are_kept(self):
        tracker = Recorder('Applied', [event('e1', 'Applied'), event('e2', 'Confirmation received'), event('e3', 'Applied', 'another-page')])
        page = tracker.find('https://jobs.test/1')
        self.assertEqual(archive_events(tracker, page, 'Applied'), 1)
        self.assertEqual(tracker.requests, [('PATCH', 'pages/e1', {'archived': True})])


if __name__ == '__main__':
    unittest.main()
