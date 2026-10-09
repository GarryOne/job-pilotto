"""Focus answers (held, moved, cancelled, sweep) and the effort sent to each model.
Guards src/ai/interviews.py, interviews_ai.py.
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)


class FocusAnswerTests(unittest.TestCase):
    def test_yes_it_happened_saves_the_notes_as_an_interview_and_moves_the_job_on(self):
        stores = store_with(huxley_job())
        app_id = only_app(stores)['id']
        notes = 'Talked to Jaya for 30 minutes: salary band 160-180k, B2B possible, next a call with the CTO.'
        out = interviews.held(stores, app_id, notes, now=NOW)
        self.assertEqual((out['ok'], out['stage'], out['review']), (True, 'Interviewing', True))
        row = stores.interviews.get(out['id'])
        self.assertEqual((row['input'], row['at'], row['app_id']), ('Notes', '2026-09-26', app_id))  # the day it was held
        self.assertEqual(row['transcript'], notes)  # the review reads the notes
        self.assertEqual(only_app(stores)['stage'], 'Interviewing')
        self.assertEqual([e['kind'] for e in stores.events.list()], ['Interviewing'])
        # Without notes it's still recorded as held, and there's nothing to review.
        stores = store_with(huxley_job())
        self.assertFalse(interviews.held(stores, only_app(stores)['id'], '', now=NOW)['review'])
        with self.assertRaises(ValueError):
            interviews.held(stores, 'no-such-job', '', now=NOW)

    def test_moved_updates_the_next_interview_and_cancelled_logs_it_without_moving_the_stage(self):
        stores = store_with(huxley_job())
        app_id = only_app(stores)['id']
        interviews.moved(stores, app_id, '2026-10-03T09:00:00+02:00')
        self.assertEqual(only_app(stores)['next_interview'], '2026-10-03T09:00:00+02:00')
        self.assertEqual([(e['kind'], e['interview_at']) for e in stores.events.list()],
                         [('Interview scheduled', '2026-10-03T09:00:00+02:00')])
        with self.assertRaises(ValueError):
            interviews.moved(stores, app_id, '')
        stores = store_with(huxley_job())
        interviews.cancelled(stores, only_app(stores)['id'])
        self.assertEqual([e['kind'] for e in stores.events.list()], ['Interview cancelled'])
        self.assertEqual((only_app(stores)['next_interview'], only_app(stores)['stage']), ('', 'Interview scheduled'))  # no Stage

    def test_the_sweep_moves_on_a_recorded_interview_saved_before(self):
        stores = store_with(huxley_job(), huxley_job(url='https://x.test/h-2'))
        first = stores.applications.get('https://x.test/h-1')
        stores.interviews.save(None, {'app_id': first['id'], 'at': '2026-09-26', 'title': 'Recorded'})
        self.assertIn('1 application(s)', interviews.sweep(stores=stores, now=NOW))
        self.assertEqual(stores.applications.get('https://x.test/h-1')['stage'], 'Interviewing')
        self.assertEqual(stores.applications.get('https://x.test/h-2')['stage'], 'Interview scheduled')  # not recorded


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
