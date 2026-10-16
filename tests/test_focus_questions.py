"""Focus asks "which job?" for an email it could not place, even when one event carries a suggested job that is not text (Sentry APP-23). Guards src/focus_state.questions."""
import unittest

from src import focus
from tests.test_focus import event, row


class QuestionsToleratesABadLinkTest(unittest.TestCase):
    def test_a_suggested_job_that_is_not_text_still_asks_which_job(self):
        job = row('job1', 'Blockdaemon', 'SRE')
        for bad in ({'url': 'https://x.test/j'}, ['https://x.test/j'], 7):
            with self.subTest(link=bad):
                asked = {**event('', 'Reply received', '2026-10-02T21:30:00+02:00'), 'needs_you': True, 'suggested_job': bad, 'id': 'e1'}
                [item] = focus.questions([job], [asked])
                self.assertEqual(item['title'], 'Which job is this email about?')
