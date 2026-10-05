import unittest
import urllib.error

from src import telegram


class FailureWordsTest(unittest.TestCase):
    """A refused digest is told in one plain sentence (6 Oct 2026: the run crashed with a traceback and an empty message)."""

    def words(self, code=None):
        error = urllib.error.HTTPError('https://api.telegram.org/bot1/sendMessage', code, 'x', {}, None) if code else OSError('down')
        return telegram.failure_words(error)

    def test_a_blocked_bot_says_so_and_what_to_do(self):
        self.assertIn('blocked', self.words(403))
        self.assertIn('Settings', self.words(403))

    def test_a_bad_token_is_named(self):
        self.assertIn('token', self.words(401))

    def test_no_network_and_other_codes_never_show_raw_text(self):
        for code in (None, 400, 429, 500):
            text = self.words(code)
            self.assertTrue(text.startswith('Telegram'), text)
            self.assertNotIn('{', text)
            self.assertNotIn('Forbidden', text)


if __name__ == '__main__':
    unittest.main()
