"""The engine's copy of a Notion page (client.Tracker._kept_page_text) is trusted only when it was read after the page settled: Notion rounds
last_edited_time down to the minute, so a copy read in the minute of an edit can miss a later edit of that same minute (7 Oct 2026: two
Strategy saves 50 s apart, and every search after used the first copy and wrote "suisse" back over the places)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.notion import client


class Fake(client.Tracker):
    def __init__(self, edited, text):
        self.edited, self.text, self.reads = edited, text, 0

    def _request(self, method, path, body=None):
        return {'last_edited_time': self.edited}

    def _page_text(self, page_id):
        self.reads += 1
        return self.text


class PageCopyTests(unittest.TestCase):
    def kept(self, tmp, read_at, text='- suisse'):
        path = Path(tmp) / 'cache' / 'notion-pages' / 'p.json'
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({'edited': '2026-10-07T10:33:00.000Z', 'read_at': read_at, 'text': text}))

    def test_a_copy_read_in_the_minute_of_an_edit_is_read_again(self):
        edited = 1791369180.0   # 2026-10-07T10:33:00Z
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', Path(tmp)), mock.patch('time.time', return_value=edited + 600):
            self.kept(tmp, read_at=edited + 51)   # read at 10:33:51; a second save landed at 10:33:54
            tracker = Fake('2026-10-07T10:33:00.000Z', '- Romandie')
            self.assertEqual(tracker._kept_page_text('p'), '- Romandie')
            self.assertEqual(tracker.reads, 1)

    def test_a_copy_read_after_the_page_settled_is_used(self):
        edited = 1791369180.0
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', Path(tmp)), mock.patch('time.time', return_value=edited + 600):
            self.kept(tmp, read_at=edited + 300, text='- Romandie')
            tracker = Fake('2026-10-07T10:33:00.000Z', 'not read')
            self.assertEqual(tracker._kept_page_text('p'), '- Romandie')
            self.assertEqual(tracker.reads, 0)


if __name__ == '__main__':
    unittest.main()
