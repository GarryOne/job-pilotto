"""Focus answers (held, moved, cancelled, sweep) and the effort sent to each model.
Guards src/ai/interviews.py, interviews_ai.py.
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)


class FocusAnswerTests(unittest.TestCase):
    def test_yes_it_happened_saves_the_notes_as_an_interview_and_moves_the_job_on(self):
        tracker = NotionPages([huxley()])
        notes = 'Talked to Jaya for 30 minutes: salary band 160-180k, B2B possible, next a call with the CTO.'
        out = interviews.held(tracker, 'h-1', notes, now=NOW)
        self.assertEqual((out['ok'], out['stage'], out['review']), (True, 'Interviewing', True))
        row = tracker.pages[out['id']]['properties']
        self.assertEqual(row['Input'], {'select': {'name': 'Notes'}})
        self.assertEqual(row['Date'], {'date': {'start': '2026-09-26'}})  # the day it was held
        self.assertEqual(row['Application'], {'relation': [{'id': 'h-1'}]})
        self.assertEqual(interviews.saved_transcript(tracker, out['id']), notes)  # the review reads the notes
        self.assertEqual(tracker.updates[-1][1]['Stage'], {'select': {'name': 'Interviewing'}})
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interviewing'}})
        # Without notes it's still recorded as held, and there's nothing to review.
        self.assertFalse(interviews.held(NotionPages([huxley()]), 'h-1', '', now=NOW)['review'])

    def test_moved_updates_the_next_interview_and_cancelled_logs_it_without_moving_the_stage(self):
        tracker = NotionPages([huxley()])
        interviews.moved(tracker, 'h-1', '2026-10-03T09:00:00+02:00')
        self.assertEqual(tracker.updates, [('h-1', {'Next interview': {'date': {'start': '2026-10-03T09:00:00+02:00'}}})])
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interview scheduled'}})
        with self.assertRaises(ValueError):
            interviews.moved(tracker, 'h-1', '')
        tracker = NotionPages([huxley()])
        interviews.cancelled(tracker, 'h-1')
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interview cancelled'}})
        self.assertEqual(tracker.updates, [('h-1', {'Next interview': {'date': None}})])  # no Stage

    def test_the_sweep_moves_on_a_recorded_interview_saved_before(self):
        tracker = FakeTracker([huxley(), huxley() | {'id': 'h-2'}])
        tracker.query_database = lambda database_id, filter_=None: (
            [] if database_id == ledger.EVENTS_DATABASE_ID else
            [{'properties': {'Date': {'type': 'date', 'date': {'start': '2026-09-26'}},
                             'Application': {'type': 'relation', 'relation': [{'id': 'h-1'}]}}}]
            if database_id == interviews.INTERVIEWS_DATABASE_ID else tracker.apps)
        with mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'ivdb'):
            self.assertIn('1 application(s)', interviews.sweep(tracker, now=NOW))
        self.assertEqual(tracker.updates, [('h-1', {'Stage': {'select': {'name': 'Interviewing'}}})])  # h-2: not recorded


class EffortTests(unittest.TestCase):
    """Haiku rejects the `effort` parameter ("This model does not support the effort parameter"): the end-to-end journey
    runs every step on Haiku, and score.py already leaves effort out for it. The review sends it only to models that take it."""

    def effort_for(self, model):
        client = FakeClient()
        interviews.analyse(client, model, 'profile', [], 'caption', 'transcript text')
        return client.calls[0]['output_config'].get('effort')

    def test_haiku_is_not_sent_an_effort(self):
        self.assertIsNone(self.effort_for('claude-haiku-4-5'))

    def test_other_models_keep_medium_effort(self):
        self.assertEqual(self.effort_for('claude-sonnet-5-5'), 'medium')
        self.assertEqual(self.effort_for('claude-opus-4-7'), 'medium')


if __name__ == '__main__':
    unittest.main()
