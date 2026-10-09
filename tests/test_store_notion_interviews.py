"""🎤 Interviews in Notion as store records (src/stores/notion_interviews.py): the contract's interview behaviour against the
in-memory Notion of the interview tests, and pages laid out as today (job line, review, Transcript toggle)."""
import unittest

from src.ai import interviews, interviews_blocks, interviews_review
from src.stores import base, notion_blocks
from src.stores.notion_interviews import NotionInterviews
from tests.interviews_fixtures import RESULT, NotionPages, app

REVIEW = notion_blocks.to_markdown(interviews_blocks.analysis_blocks(RESULT, {'filled': [], 'differs': [], 'changes': {}}))


class NotionInterviewsTests(unittest.TestCase):
    def setUp(self):
        self.notion = NotionPages([app('app-1', 'Acme', 'Interview scheduled', '2026-09-01')])
        # The fake answers for whatever interviews.INTERVIEWS_DATABASE_ID holds when the test runs (other tests set it): '' broke in a full run.
        self.s = NotionInterviews(self.notion, database_id=interviews.INTERVIEWS_DATABASE_ID)

    def texts(self, page_id):
        return [(b['type'], interviews_review._plain_block(b)) for b in self.notion._children(page_id)]

    def test_an_interview_is_saved_updated_and_archived(self):
        row = self.s.save(None, {'app_id': 'app-1', 'title': 'First call', 'transcript': 'A: hi', 'questions': 3})
        self.assertEqual(set(row), set(base.INTERVIEW_FIELDS))
        self.s.save(row['id'], {'review': '## Went well'})
        got = self.s.get(row['id'])
        self.assertEqual((got['transcript'], got['title'], got['questions'], got['app_id']), ('A: hi', 'First call', 3, 'app-1'))
        self.assertEqual(len(self.s.list(app_id='app-1')), 1)
        self.assertEqual(self.s.list(app_id='app-2'), [])
        self.s.archive(row['id'])
        self.assertEqual(self.notion.archived, [row['id']])
        with self.assertRaises(KeyError):
            self.s.save(row['id'], {'no such field': 1})

    def test_a_new_page_is_laid_out_as_today(self):
        row = self.s.save(None, {'app_id': 'app-1', 'title': 'Acme · Technical', 'transcript': 'A: hi'})
        kinds = self.texts(row['id'])
        self.assertTrue(kinds[0][1].startswith('🔗 Job: '))
        self.assertEqual(kinds[1], ('paragraph', interviews_review.PLACEHOLDER))
        self.assertEqual(kinds[2], ('heading_3', 'Transcript'))

    def test_a_review_replaces_the_placeholder_and_comes_back_as_written(self):
        row = self.s.save(None, {'app_id': 'app-1', 'title': 'Call', 'transcript': 'A: hi there, a long enough transcript'})
        self.s.save(row['id'], {'review': REVIEW, 'overall': 'positive'})
        texts = [t for _, t in self.texts(row['id'])]
        self.assertNotIn(interviews_review.PLACEHOLDER, texts)
        self.assertEqual(texts[1], RESULT['summary'])
        got = self.s.get(row['id'])
        self.assertEqual((got['review'], got['overall'], got['transcript']), (REVIEW, 'positive', 'A: hi there, a long enough transcript'))
        self.s.save(row['id'], {'review': REVIEW.replace('Went well overall.', 'Second look.')})
        self.assertEqual(texts.count('Strengths'), 1)
        self.assertEqual([t for _, t in self.texts(row['id'])].count('Strengths'), 1)
        self.assertTrue(self.s.get(row['id'])['review'].startswith('Second look.'))

    def test_a_column_keeps_its_text_as_written(self):
        row = self.s.save(None, {'title': 'Tech *1* [x](y)', 'round': 'Round `2`'})
        self.assertEqual((self.s.get(row['id'])['title'], self.s.get(row['id'])['round']), ('Tech *1* [x](y)', 'Round `2`'))

    def test_the_transcript_is_replaced_whole(self):
        row = self.s.save(None, {'title': 'Call', 'transcript': 'old words'})
        self.s.save(row['id'], {'transcript': 'Anna: new words'})
        self.assertEqual(self.s.get(row['id'])['transcript'], 'Anna: new words')
        self.assertEqual([t for _, t in self.texts(row['id'])].count('Transcript'), 1)


if __name__ == '__main__':
    unittest.main()
