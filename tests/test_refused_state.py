"""What a page read in the real tab IS (owner, 20 Oct 2026): a refusal status and a login address are floors, a long page is a page, the AI answers in a fixed
shape for the rest, and a short word rule answers only when no AI could. Nothing here solves or clicks anything."""
import unittest
from unittest import mock

from src.ai import decide
from src.sources import refused_state

SHORT_CHECK = '<html><title>Just a moment...</title><body>Checking your browser before accessing the site.</body></html>'
SHORT_CAPTCHA = '<html><body><iframe src="https://challenges.example.net/box"></iframe>Please verify you are human</body></html>'
LONG = '<html><body>' + 'Offre d emploi ' * 2000 + '</body></html>'
# A real check page is long in bytes (inline scripts and styles) but says little: measured 21 Oct 2026 on two sites, 29 KB with a few hundred characters of text.
LONG_CHECK = '<html><head><title>Just a moment...</title><script>' + 'var a=1;' * 3500 + '</script></head><body>Checking your browser before accessing the site.</body></html>'


class PageStateTest(unittest.TestCase):
    def state(self, status=200, html=LONG, title='', final='', ai=None):
        with mock.patch.object(decide, 'one', return_value=ai) as asked:
            self.asked = asked
            return refused_state.page_state(status, html, title, final)

    def test_a_refusal_status_or_a_login_address_is_decided_without_the_ai(self):
        self.assertEqual(self.state(403, SHORT_CHECK, ai='page'), 'refused')
        self.assertEqual(self.state(200, SHORT_CHECK, final='https://jobs.coop.ch/login?next=/', ai='page'), 'login')
        self.assertEqual(self.state(200, SHORT_CHECK, final='https://www.linkedin.com/uas/login', ai='page'), 'login')
        self.asked.assert_not_called()

    def test_a_long_page_is_a_page_and_an_empty_one_is_not(self):
        self.assertEqual(self.state(200, LONG, ai='captcha'), 'page')
        self.assertEqual(self.state(200, '  ', ai='page'), 'refused')

    def test_a_long_page_with_little_to_read_is_not_a_page_by_its_size(self):
        self.assertGreater(len(LONG_CHECK), refused_state.BIG_PAGE)
        self.assertEqual(self.state(200, LONG_CHECK), 'passive_check', 'no AI: the word rule, not the size')
        self.assertEqual(self.state(200, LONG_CHECK, ai='captcha'), 'captcha')
        self.asked.assert_called()

    def test_the_ai_answer_decides_any_language_and_only_a_fixed_answer_counts(self):
        for answer in refused_state.STATES:
            self.assertEqual(self.state(200, '<html><body>Un instant, vérification…</body></html>', ai=answer), answer)
        self.assertIn('captcha', self.asked.call_args.args[3], 'the fixed answers are handed to the AI')
        self.assertEqual(self.state(200, SHORT_CHECK, ai='click the button'), 'passive_check', 'an answer outside the list falls back to the word rule')

    def test_without_the_ai_a_short_word_rule_answers_and_never_calls_a_page_good_by_default_of_a_check(self):
        self.assertEqual(self.state(200, SHORT_CHECK), 'passive_check')
        self.assertEqual(self.state(200, SHORT_CAPTCHA), 'captcha')
        self.assertEqual(self.state(200, '<html><body>Access denied</body></html>'), 'refused')

    def test_the_text_sent_to_the_ai_is_short_and_names_embedded_frames(self):
        self.state(200, SHORT_CAPTCHA, title='Check')
        text = self.asked.call_args.args[2]
        self.assertIn('challenges.example.net', text)
        self.assertLess(len(text), 700)


if __name__ == '__main__':
    unittest.main()
