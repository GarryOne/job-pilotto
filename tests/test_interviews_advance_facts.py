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
            stores = store_with(huxley_job(stage))
            self.assertEqual(interviews.advance(stores, only_app(stores), now=NOW, round_='Technical interview',
                                                next_step='Hiring manager call next week'), 'Interviewing')
            self.assertEqual([e['kind'] for e in stores.events.list()], ['Interviewing'])
            job = only_app(stores)
            self.assertEqual((job['stage'], job['next_step'], job['next_interview']),
                             ('Interviewing', 'Hiring manager call next week', ''))
        # A coming interview stays; "not stated" is no next step.
        stores = store_with(huxley_job(next_interview='2026-10-02T09:00:00Z'))
        interviews.advance(stores, only_app(stores), now=NOW, next_step='not stated')
        job = only_app(stores)
        self.assertEqual((job['stage'], job['next_step'], job['next_interview']), ('Interviewing', '', '2026-10-02T09:00:00Z'))

    def test_never_backwards_and_never_a_closed_stage(self):
        stores = store_with(huxley_job('Interviewing'))
        self.assertIsNone(interviews.advance(stores, only_app(stores), now=NOW, next_step='Final round'))
        self.assertEqual((only_app(stores)['stage'], only_app(stores)['next_step']), ('Interviewing', 'Final round'))
        for stage in ('Offer', 'Rejected', 'Withdrawn', 'Closed', 'Dismissed'):
            stores = store_with(huxley_job(stage))
            before = only_app(stores)
            self.assertIsNone(interviews.advance(stores, before, now=NOW, next_step='x', changes={'salary': 'CHF 1'}))
            self.assertEqual((only_app(stores), stores.events.list()), (before, []), stage)


class FactsTests(unittest.TestCase):
    def test_empty_fields_are_filled_same_values_left_and_different_ones_reported(self):
        row = huxley_job(work_mode='Remote', call_facts='Team size: about 10')
        merged = interviews.merge_facts(row, {'facts': FACTS})
        self.assertEqual(merged['changes'], {
            'salary': 'CHF 160-180k/year',
            'contract': 'B2B / contractor',  # the option's own spelling
            'call_facts': 'Team size: about 10 · Your ask: CHF 170k'})
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
        row = huxley_job(location='Remote')
        merged = interviews.merge_facts(row, {'facts': [
            {'field': 'location', 'value': 'Remote, Europe (Switzerland via employer of record, or Romania)', 'quote': 'q'}]})
        self.assertEqual(merged['changes']['location'], 'Remote, Europe (Switzerland via employer of record, or Romania)')
        self.assertEqual([(f['label'], f.get('refined')) for f in merged['filled']], [('Location', 'Remote')])
        self.assertEqual(merged['differs'], [])
        # Selects are never refined, and a value that does not contain the current one is only reported.
        other = interviews.merge_facts(row, {'facts': [{'field': 'location', 'value': 'Zurich, hybrid', 'quote': 'q'}]})
        self.assertEqual((other['changes'], [f['label'] for f in other['differs']]), ({}, ['Location']))

    def test_the_review_fills_the_job_and_reports_differences_without_overwriting(self):
        original, fixtures.RESULT = fixtures.RESULT, dict(fixtures.RESULT, application=0, round='Technical interview', facts=FACTS,
                                        next_step='Intro with the hiring manager')
        try:
            stores, sent = store_with(huxley_job()), []
            log = interviews.run(stores=stores, note='/interview Huxley\n' + 'Notes about the call. ' * 5,
                                 client=FakeClient(), now=NOW, send=sent.append)
        finally:
            fixtures.RESULT = original
        job = only_app(stores)
        self.assertEqual((job['stage'], job['salary'], job['next_interview']), ('Interviewing', 'CHF 160-180k/year', ''))
        self.assertEqual(job['location'], 'Remote')  # the call said something else: reported instead
        self.assertIn('Huxley, Technical interview', log)
        self.assertIn('Stage → Interviewing; filled Salary (CHF 160-180k/year), Contract (B2B / contractor)', log)
        self.assertIn('differs from the job, not changed: Location (call: Hybrid, Zurich 2 days; job: Remote)', log)
        [interview] = stores.interviews.list()
        page = interview['review']
        self.assertIn('Facts from the call', page)
        self.assertIn('“two days a week in Zurich” ⚠️ Different from the job (it says “Remote”): not changed', page)
        self.assertIn('Salary: CHF 160-180k/year — “the band is 160 to 180 thousand francs” (added to the job)', page)
        self.assertIn('Added to the job: Salary: CHF 160-180k/year', sent[0])
        self.assertIn('Location: the call said “Hybrid, Zurich 2 days”, the job says “Remote” (not changed)', sent[0])
        self.assertIn('facts', interviews.SCHEMA['required'])  # the same single call extracts them



# The owner's Huxley recruiter screen (30 Sep 2026), shortened: reviewed once before facts were extracted.


if __name__ == '__main__':
    unittest.main()
