"""Reviewing a saved interview again from the app: the review replaced, the job filled, nothing else moved.
Guards src/ai/interviews.py, and the Notion page's review (src/stores/notion_interviews.py, src/ai/interviews_review.py).
"""
import unittest

from tests.interviews_fixtures import *  # noqa: F401,F403 — the shared fakes and fixtures
from tests.interviews_fixtures import setUpModule  # noqa: F401 (the model's answer)


class ReviewAgainTests(unittest.TestCase):
    def reviewed_before_facts(self):
        """The Huxley interview as it is in the owner's data: saved, reviewed without facts, job at Screening."""
        stores = store_with(huxley_job())
        row = interviews.save(stores, HUXLEY_CALL, 'Huxley · Recruiter screen', job_url='https://x.test/h-1', now=NOW)
        interviews.run(stores=stores, page_id=row['id'], client=ResultClient(FIRST_REVIEW), now=NOW)
        self.assertNotIn('Facts from the call', stores.interviews.get(row['id'])['review'])
        return stores, row['id']

    def test_review_again_fills_the_empty_job_fields_and_rebuilds_the_review_without_moving_the_stage(self):
        stores, page_id = self.reviewed_before_facts()
        job, events, before = only_app(stores), len(stores.events.list()), stores.interviews.get(page_id)
        self.assertEqual((job['stage'], job['next_step'], job['salary']), ('Screening', '', ''))
        client, sent, found = ResultClient(AGAIN_REVIEW), [], {}
        log = interviews.run(stores=stores, page_id=page_id, client=client, now=NOW, send=sent.append, found=found)
        self.assertEqual(found, {'application': job['id'], 'title': 'Huxley · Recruiter screen'})  # its run links to the job too, under the interview's own title
        self.assertEqual(len(client.calls), 1)  # one Sonnet call
        self.assertIn('Speaker 1: The budget is around 100 to 150 thousand euros', client.calls[0]['messages'][0]['content'])
        # The job: only its empty fields, the next step; no Stage, no event, Company still empty, Location kept.
        job = only_app(stores)
        self.assertEqual((job['salary'], job['contract']), ('EUR 100-150k/year (max)', 'Employee or B2B'))
        self.assertEqual(job['call_facts'], 'Visa/permit: No visa sponsorship · Relocation: No relocation support'
                                            ' · Company size: About 500 people')
        self.assertEqual(job['next_step'], 'Another call about salary, setup and relocation')
        self.assertEqual((job['stage'], job['location'], job['company']), ('Screening', 'Remote', ''))
        self.assertEqual(len(stores.events.list()), events)
        # The interview: one review (replaced), with the facts; its title, job, input, date and transcript kept; cost added.
        row = stores.interviews.get(page_id)
        self.assertEqual((row['title'], row['app_id'], row['input'], row['at'], row['transcript']),
                         (before['title'], before['app_id'], 'Recording', before['at'], HUXLEY_CALL))
        self.assertAlmostEqual(row['cost'], round(before['cost'] * 2, 4))
        self.assertEqual(row['review'].count('### Questions'), 1)
        self.assertNotIn('A first screen for an unnamed finance client', row['review'])
        self.assertIn('Different from the job (it says “Remote”)', row['review'])
        self.assertIn('Salary: EUR 100-150k/year (max)', row['review'])
        self.assertTrue(log.startswith('Interview analysed again (Huxley, Recruiter screen'))
        self.assertIn('Filled Salary', log)
        self.assertNotIn('Stage', sent[0])
        # Twice: nothing changes on the job, still one review, the cost noted.
        job = only_app(stores)
        log = interviews.run(stores=stores, page_id=page_id, client=ResultClient(AGAIN_REVIEW), now=NOW)
        self.assertEqual(only_app(stores), job)
        self.assertEqual(stores.interviews.get(page_id)['review'].count('### Questions'), 1)
        self.assertEqual(len(stores.events.list()), events)
        self.assertIn('Nothing new for the job', log)
        self.assertAlmostEqual(stores.interviews.get(page_id)['cost'], round(before['cost'] * 3, 4))

    def test_a_call_that_does_not_name_the_company_never_fills_company(self):
        self.assertEqual(interviews.named('unnamed finance client'), '')
        merged = interviews.merge_facts(huxley_job(), AGAIN_REVIEW)
        self.assertNotIn('company', merged['changes'])
        self.assertEqual(interviews.interview_title(AGAIN_REVIEW['company'], 'Recruiter screen', huxley_job()), 'Huxley · Recruiter screen')

    def test_a_failed_review_again_leaves_the_interview_and_the_job_as_they_were(self):
        stores, page_id = self.reviewed_before_facts()
        row, job = stores.interviews.get(page_id), only_app(stores)
        with self.assertRaises(RuntimeError):
            interviews.run(stores=stores, page_id=page_id, client=ResultClient(error=RuntimeError('overloaded')), now=NOW)
        self.assertEqual((stores.interviews.get(page_id), only_app(stores)), (row, job))

    def test_advance_twice_adds_no_second_event_and_does_not_move_the_stage_again(self):
        for stage, round_ in (('Interview scheduled', 'Recruiter screen'), ('Screening', 'Technical 1'),
                              ('Recruiter lead', 'Hiring manager')):
            stores = store_with(huxley_job(stage))
            first = interviews.advance(stores, only_app(stores), now=NOW, round_=round_)
            events, stage_after = len(stores.events.list()), only_app(stores)['stage']
            self.assertIsNotNone(first)
            self.assertIsNone(interviews.advance(stores, only_app(stores), now=NOW, round_=round_))
            self.assertEqual((len(stores.events.list()), only_app(stores)['stage']), (events, stage_after))


class NotionReviewPageTests(unittest.TestCase):
    """A Notion interview page keeps its layout when the review is replaced (src/stores/notion_interviews.py)."""

    def setUp(self):
        from src.stores.notion_interviews import NotionInterviews
        self.tracker = NotionPages([huxley()])
        self.pages = NotionInterviews(self.tracker, database_id=interviews.INTERVIEWS_DATABASE_ID)
        self.page = self.pages.save(None, {'title': 'Huxley · Recruiter screen', 'app_id': 'h-1', 'transcript': HUXLEY_CALL})
        self.pages.save(self.page['id'], {'review': notion_blocks.to_markdown(interviews.analysis_blocks(FIRST_REVIEW))})

    def test_review_blocks_are_found_wherever_the_review_is_and_duplicates_are_cleared(self):
        page_id = self.page['id']
        # A half-finished replace left a second review at the end, after a note of the owner's.
        self.tracker._request('PATCH', f'blocks/{page_id}/children', {'children': [interviews._block('paragraph', 'My own note')]
                                                                       + interviews.analysis_blocks(FIRST_REVIEW)})
        self.assertEqual(headings(self.tracker, page_id).count('Questions'), 2)
        self.pages.save(page_id, {'review': notion_blocks.to_markdown(interviews.analysis_blocks(AGAIN_REVIEW))})
        self.assertEqual(headings(self.tracker, page_id).count('Questions'), 1)
        self.assertIn('My own note', str(self.tracker.blocks[page_id]))
        self.assertEqual(interviews._plain_block(self.tracker.blocks[page_id][0]), '🔗 Job: Huxley · SRE')
        self.assertEqual(self.pages.get(page_id)['transcript'], HUXLEY_CALL)

    def test_notion_refusing_the_new_blocks_leaves_the_old_review_whole(self):
        page_id = self.page['id']
        blocks = [dict(b) for b in self.tracker.blocks[page_id]]
        real = self.tracker._request

        def refuse(method, path, body=None):
            if method == 'PATCH' and path.endswith('/children'):
                raise RuntimeError('Notion 502')
            return real(method, path, body)
        self.tracker._request = refuse
        with self.assertRaises(RuntimeError):
            self.pages.save(page_id, {'review': notion_blocks.to_markdown(interviews.analysis_blocks(AGAIN_REVIEW))})
        self.assertEqual(self.tracker.blocks[page_id], blocks)


if __name__ == '__main__':
    unittest.main()
