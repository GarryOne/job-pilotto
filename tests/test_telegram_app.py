import io
import unittest
from contextlib import redirect_stdout

from src import telegram


class ToAppTest(unittest.TestCase):
    def test_a_message_without_telegram_is_printed_between_markers_for_the_desktop_app(self):
        out = io.StringIO()
        with redirect_stdout(out):
            telegram.to_app('💡 <b>Insight</b>', {'inline_keyboard': []})
        self.assertEqual(out.getvalue(), '<<<message\n💡 <b>Insight</b>\nmessage>>>\n')


if __name__ == '__main__':
    unittest.main()
