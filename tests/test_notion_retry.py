"""The Notion client waits and retries on 429 (busy) and 502/503/504 (briefly down), then gives up."""
import io
import json
import unittest
import urllib.error

from src.notion.client import Tracker


def http_error(code, retry_after=None):
    headers = {'Retry-After': retry_after} if retry_after else {}
    return urllib.error.HTTPError('https://api.notion.com/v1/x', code, 'error', headers, io.BytesIO(b'{}'))


class Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class NotionRetryTest(unittest.TestCase):
    def test_429_then_answer(self):
        waits, replies = [], [http_error(429, '2'), http_error(503), Answer(json.dumps({'ok': True}).encode())]

        def opener(request, timeout):
            reply = replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply

        tracker = Tracker('t', 'db', opener=opener, sleep=waits.append)
        self.assertEqual(tracker._request('GET', 'pages/x'), {'ok': True})
        self.assertEqual(waits, [2.0, 1.0])

    def test_gives_up_and_other_errors_fail_at_once(self):
        waits = []

        def busy(request, timeout):
            raise http_error(502)

        with self.assertRaises(urllib.error.HTTPError):
            Tracker('t', 'db', opener=busy, sleep=waits.append)._request('GET', 'pages/x')
        self.assertEqual(waits, [0.5, 1.0, 2.0, 4.0])
        waits.clear()

        def missing(request, timeout):
            raise http_error(404)

        with self.assertRaises(urllib.error.HTTPError):
            Tracker('t', 'db', opener=missing, sleep=waits.append)._request('GET', 'pages/x')
        self.assertEqual(waits, [])


if __name__ == '__main__':
    unittest.main()
