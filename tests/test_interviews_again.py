"""Reviewing a saved interview again from the app: the review replaced, the job filled, nothing else moved.
Guards src/ai/interviews.py, interviews_review.py.
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)


class ReviewAgainTests(unittest.TestCase):
    def setUp(self):
        for module in (interviews, ledger):
            patcher = mock.patch.object(module, 'EVENTS_DATABASE_ID', 'events-db')
            patcher.start()
            self.addCleanup(patcher.stop)

    def reviewed_before_facts(self):
        """The Huxley row as it is in the owner's Notion: saved, reviewed without facts, job at Screening."""
        tracker = LiveApps([huxley()])
        page = interviews.save(tracker, HUXLEY_CALL, 'Huxley · Recruiter screen', job_url='https://x.test/h-1', now=NOW)
        interviews.run(tracker, page_id=page['id'], client=ResultClient(FIRST_REVIEW), now=NOW)
        self.assertNotIn('Facts from the call', headings(tracker, page['id']))
        return tracker, page['id']

    def test_review_again_fills_the_empty_job_fields_and_rebuilds_the_review_without_moving_the_stage(self):
        tracker, page_id = self.reviewed_before_facts()
        job, events, title = tracker.apps[0]['properties'], len(tracker.created), tracker.pages[page_id]['properties']['Interview']
        self.assertEqual((plain(job['Stage']), plain(job.get('Next step')), plain(job.get('Salary'))), ('Screening', None, None))
        cost_before = tracker.pages[page_id]['properties']['Cost (USD)']['number']
        client, sent = ResultClient(AGAIN_REVIEW), []
        found = {}
        log = interviews.run(tracker, page_id=page_id, client=client, now=NOW, send=sent.append, found=found)
        self.assertEqual(found, {'application': tracker.apps[0]['id'], 'title': 'Huxley · Recruiter screen'})  # Review again: its run links to the job too, under the row's own title

        self.assertEqual(len(client.calls), 1)  # one Sonnet call
        self.assertIn('HQ Greece', client.calls[0]['messages'][0]['content'] + AGAIN_REVIEW['summary'])
        self.assertIn('Speaker 1: The budget is around 100 to 150 thousand euros', client.calls[0]['messages'][0]['content'])
        # The job: only its empty fields, the next step; no Stage, no event, Company still empty, Location kept.
        self.assertEqual(plain(job['Salary']), 'EUR 100-150k/year (max)')
        self.assertEqual(plain(job['Contract']), 'Employee or B2B')
        self.assertEqual(plain(job['Call facts']), 'Visa/permit: No visa sponsorship · Relocation: No relocation support'
                                                   ' · Company size: About 500 people')
        self.assertEqual(plain(job['Next step']), 'Another call about salary, setup and relocation')
        self.assertEqual((plain(job['Stage']), plain(job['Location']), plain(job['Company'])), ('Screening', 'Remote', ''))
        self.assertEqual(len(tracker.created), events)
        for _, update in tracker.updates[-1:]:
            self.assertFalse({'Stage', 'Next interview', 'Company'} & set(update))
        # The row: one review (replaced), with the facts; its title, link, input, date and transcript kept; cost added.
        row = tracker.pages[page_id]['properties']
        self.assertEqual(row['Interview'], title)
        self.assertEqual(row['Application'], {'relation': [{'id': 'h-1'}]})
        self.assertEqual(row['Input'], {'select': {'name': 'Recording'}})
        self.assertAlmostEqual(row['Cost (USD)']['number'], round(cost_before * 2, 4))
        self.assertEqual(headings(tracker, page_id).count('Questions'), 1)
        self.assertEqual(headings(tracker, page_id).count('Facts from the call'), 1)
        text_ = str(tracker.blocks[page_id])
        self.assertNotIn('A first screen for an unnamed finance client', text_)
        self.assertIn('Different from the job (it says “Remote”)', text_)
        self.assertIn('Salary: EUR 100-150k/year (max)', text_)
        self.assertEqual(interviews._plain_block(tracker.blocks[page_id][0]), '🔗 Job: Huxley · SRE')
        self.assertEqual(interviews.saved_transcript(tracker, page_id), HUXLEY_CALL)
        self.assertTrue(log.startswith('Interview analysed again (Huxley, Recruiter screen'))
        self.assertIn('Filled Salary', log)
        self.assertNotIn('Stage', sent[0])

        # Twice: nothing changes on the job, still one review, the cost noted.
        updates, blocks = len(tracker.updates), len(tracker.blocks[page_id])
        log = interviews.run(tracker, page_id=page_id, client=ResultClient(AGAIN_REVIEW), now=NOW)
        self.assertFalse([u for u in tracker.updates[updates:] if u[0] == 'h-1'])
        self.assertEqual(len(tracker.blocks[page_id]), blocks)
        self.assertEqual(headings(tracker, page_id).count('Questions'), 1)
        self.assertEqual(len(tracker.created), events)
        self.assertIn('Nothing new for the job', log)
        self.assertAlmostEqual(tracker.pages[page_id]['properties']['Cost (USD)']['number'], round(cost_before * 3, 4))

    def test_a_call_that_does_not_name_the_company_never_fills_company(self):
        self.assertEqual(interviews.named('unnamed finance client'), '')
        merged = interviews.merge_facts(huxley(), AGAIN_REVIEW)
        self.assertNotIn('Company', merged['changes'])
        self.assertEqual(interviews.interview_title(AGAIN_REVIEW['company'], 'Recruiter screen', huxley()), 'Huxley · Recruiter screen')

    def test_a_failed_review_again_leaves_the_page_and_the_job_as_they_were(self):
        tracker, page_id = self.reviewed_before_facts()
        blocks, updates = [dict(b) for b in tracker.blocks[page_id]], len(tracker.updates)
        with self.assertRaises(RuntimeError):
            interviews.run(tracker, page_id=page_id, client=ResultClient(error=RuntimeError('overloaded')), now=NOW)
        self.assertEqual(tracker.blocks[page_id], blocks)
        # Notion refuses the new blocks: the old review stays whole, nothing else is written.
        real = tracker._request

        def refuse(method, path, body=None):
            if method == 'PATCH' and path.endswith('/children'):
                raise RuntimeError('Notion 502')
            return real(method, path, body)
        tracker._request = refuse
        with self.assertRaises(RuntimeError):
            interviews.run(tracker, page_id=page_id, client=ResultClient(AGAIN_REVIEW), now=NOW)
        self.assertEqual(tracker.blocks[page_id], blocks)
        self.assertEqual(len(tracker.updates), updates)

    def test_review_blocks_are_found_wherever_the_review_is_and_duplicates_are_cleared(self):
        tracker, page_id = self.reviewed_before_facts()
        # A half-finished replace left a second review at the end, after a note of the owner's.
        tracker._request('PATCH', f'blocks/{page_id}/children', {'children': [interviews._block('paragraph', 'My own note')]
                                                                  + interviews.analysis_blocks(FIRST_REVIEW)})
        self.assertEqual(headings(tracker, page_id).count('Questions'), 2)
        interviews.run(tracker, page_id=page_id, client=ResultClient(AGAIN_REVIEW), now=NOW)
        self.assertEqual(headings(tracker, page_id).count('Questions'), 1)
        self.assertIn('My own note', str(tracker.blocks[page_id]))
        self.assertEqual(interviews.saved_transcript(tracker, page_id), HUXLEY_CALL)

    def test_advance_twice_adds_no_second_event_and_does_not_move_the_stage_again(self):
        for stage, round_ in (('Interview scheduled', 'Recruiter screen'), ('Screening', 'Technical 1'),
                              ('Recruiter lead', 'Hiring manager')):
            tracker = LiveApps([huxley(stage)])
            first = interviews.advance(tracker, tracker.apps[0], now=NOW, round_=round_)
            events, stage_after = len(tracker.created), plain(tracker.apps[0]['properties']['Stage'])
            self.assertIsNotNone(first)
            self.assertIsNone(interviews.advance(tracker, tracker.apps[0], now=NOW, round_=round_))
            self.assertEqual((len(tracker.created), plain(tracker.apps[0]['properties']['Stage'])), (events, stage_after))


if __name__ == '__main__':
    unittest.main()
