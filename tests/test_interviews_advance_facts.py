"""Advancing the application after a held interview, and the facts a call reveals about the job.
Guards src/ai/interviews.py, interviews_facts.py, interviews_stages.py.
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)
import tests.interviews_fixtures as fixtures  # the fake model reads RESULT from there


class AdvanceTests(unittest.TestCase):
    def test_a_held_interview_moves_talks_forward_with_its_event_next_step_and_clears_the_past_date(self):
        # A recruiter screen held: Screening (from a booked call or a lead), unchanged at Screening.
        for stage, expected in (('Interview scheduled', 'Screening'), ('Recruiter lead', 'Screening'), ('Screening', None)):
            self.assertEqual(interviews.held_stage(stage, 'Recruiter screen'), expected)
        # A technical or hiring-manager round: Interviewing.
        for stage in ('Interview scheduled', 'Screening', 'Recruiter lead'):
            tracker = FakeTracker([])
            self.assertEqual(interviews.advance(tracker, huxley(stage), now=NOW, round_='Technical interview',
                                                next_step='Hiring manager call next week'), 'Interviewing')
            self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interviewing'}})
            self.assertEqual(tracker.updates, [('h-1', {
                'Stage': {'select': {'name': 'Interviewing'}},
                'Next step': {'rich_text': [{'text': {'content': 'Hiring manager call next week'}}]},
                'Next interview': {'date': None}})])
        # A coming interview stays; "not stated" is no next step.
        tracker = FakeTracker([])
        row = huxley(**{'Next interview': {'type': 'date', 'date': {'start': '2026-10-02T09:00:00Z'}}})
        interviews.advance(tracker, row, now=NOW, next_step='not stated')
        self.assertEqual(tracker.updates, [('h-1', {'Stage': {'select': {'name': 'Interviewing'}}})])

    def test_never_backwards_and_never_a_closed_stage(self):
        tracker = FakeTracker([])
        self.assertIsNone(interviews.advance(tracker, huxley('Interviewing'), now=NOW, next_step='Final round'))
        self.assertNotIn('Stage', tracker.updates[0][1])  # already there: next step and the date only
        for stage in ('Offer', 'Rejected', 'Withdrawn', 'Closed', 'Dismissed'):
            tracker = FakeTracker([])
            self.assertIsNone(interviews.advance(tracker, huxley(stage), now=NOW, next_step='x',
                                                 changes={'Salary': {'rich_text': []}}))
            self.assertEqual((tracker.updates, tracker.created), ([], []), stage)


class FactsTests(unittest.TestCase):
    def test_empty_fields_are_filled_same_values_left_and_different_ones_reported(self):
        row = huxley(**{'Work mode': {'type': 'select', 'select': {'name': 'Remote'}},
                        'Call facts': text('Team size: about 10')})
        merged = interviews.merge_facts(row, {'facts': FACTS})
        self.assertEqual(merged['changes'], {
            'Salary': {'rich_text': [{'text': {'content': 'CHF 160-180k/year'}}]},
            'Contract': {'select': {'name': 'B2B / contractor'}},  # the option's own spelling
            'Call facts': {'rich_text': [{'text': {'content': 'Team size: about 10 · Your ask: CHF 170k'}}]}})
        self.assertEqual([f['label'] for f in merged['filled']], ['Salary', 'Contract', 'Your ask'])
        self.assertEqual([(f['label'], f['current'], f['value']) for f in merged['differs']],
                         [('Location', 'Remote', 'Hybrid, Zurich 2 days'), ('Team size', 'about 10', '8 SREs')])
        self.assertEqual([f['label'] for f in merged['same']], ['Work mode'])
        # Unknown select values and "not stated" are dropped.
        self.assertEqual(interviews.facts_of({'facts': [{'field': 'contract', 'value': 'freelance-ish', 'quote': ''}]}), [])

    def test_the_review_prompt_keeps_location_short_and_conditions_in_relocation(self):
        self.assertIn('a SHORT summary', interviews.SYSTEM)
        self.assertIn('belong in relocation', interviews.SYSTEM)

    def test_a_more_specific_location_refines_the_job_but_a_different_one_does_not(self):
        row = huxley(Location=text('Remote'))
        merged = interviews.merge_facts(row, {'facts': [
            {'field': 'location', 'value': 'Remote, Europe (Switzerland via employer of record, or Romania)', 'quote': 'q'}]})
        self.assertEqual(merged['changes']['Location'],
                         {'rich_text': [{'text': {'content': 'Remote, Europe (Switzerland via employer of record, or Romania)'}}]})
        self.assertEqual([(f['label'], f.get('refined')) for f in merged['filled']], [('Location', 'Remote')])
        self.assertEqual(merged['differs'], [])
        # Selects are never refined, and a value that does not contain the current one is only reported.
        other = interviews.merge_facts(row, {'facts': [{'field': 'location', 'value': 'Zurich, hybrid', 'quote': 'q'}]})
        self.assertEqual((other['changes'], [f['label'] for f in other['differs']]), ({}, ['Location']))

    def test_the_review_fills_the_job_and_reports_differences_without_overwriting(self):
        original, fixtures.RESULT = fixtures.RESULT, dict(fixtures.RESULT, application=0, round='Technical interview', facts=FACTS,
                                        next_step='Intro with the hiring manager')
        try:
            tracker, sent = FakeTracker([huxley()]), []
            log = interviews.run(tracker, note='/interview Huxley\n' + 'Notes about the call. ' * 5,
                                 client=FakeClient(), now=NOW, send=sent.append)
        finally:
            fixtures.RESULT = original
        (page_id, update), = tracker.updates
        self.assertEqual(update['Stage'], {'select': {'name': 'Interviewing'}})
        self.assertEqual(update['Salary'], {'rich_text': [{'text': {'content': 'CHF 160-180k/year'}}]})
        self.assertEqual(update['Next interview'], {'date': None})
        self.assertNotIn('Location', update)  # "Remote" stays: the call said something else, reported instead
        self.assertIn('Huxley, Technical interview', log)
        self.assertIn('Stage → Interviewing; filled Salary (CHF 160-180k/year), Contract (B2B / contractor)', log)
        self.assertIn('differs from the job, not changed: Location (call: Hybrid, Zurich 2 days; job: Remote)', log)
        page = str(tracker.requests[0]['children'])
        self.assertIn('Facts from the call', page)
        self.assertIn('“two days a week in Zurich” ⚠️ Different from the job (it says “Remote”): not changed', page)
        self.assertIn('Salary: CHF 160-180k/year — “the band is 160 to 180 thousand francs” (added to the job)', page)
        self.assertIn('Added to the job: Salary: CHF 160-180k/year', sent[0])
        self.assertIn('Location: the call said “Hybrid, Zurich 2 days”, the job says “Remote” (not changed)', sent[0])
        self.assertIn('facts', interviews.SCHEMA['required'])  # the same single call extracts them



# The owner's Huxley recruiter screen (30 Sep 2026), shortened: reviewed once before facts were extracted.


if __name__ == '__main__':
    unittest.main()
