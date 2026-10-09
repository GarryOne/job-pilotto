"""The Notion client waits and retries on 429 (busy) and 502/503/504 (briefly down), then gives up. Cloudflare's 520/522/524 only when
sending again can't make a second copy: a new page after looking it up by its Job URL (src/notion/retry.py)."""
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

    def test_a_400_keeps_notions_reason(self):
        # urllib would say only "Bad Request". The column name is in the body, and a run row is dropped
        # when that name never reaches the caller.
        body = json.dumps({'message': 'Run id is not a property that exists.'}).encode()

        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 400, 'Bad Request', {}, io.BytesIO(body))

        with self.assertRaises(urllib.error.HTTPError) as caught:
            Tracker('t', 'db', opener=opener, sleep=lambda _s: None)._request('POST', 'pages', {'properties': {}})
        self.assertIn('Run id is not a property that exists', str(caught.exception))



JOB = {'parent': {'database_id': 'db1'}, 'properties': {'Job URL': {'url': 'https://jobs.test/a'}, 'Job': {'title': []}}}


class EdgeErrorTest(unittest.TestCase):
    """A 520 once, then Notion answers: what was sent, in order (9 Oct 2026: a 520 on POST pages stopped a Move to Notion)."""
    def run_with(self, method, path, body, answers):
        sent, waits = [], []
        def opener(request, timeout):
            sent.append((request.get_method(), request.full_url.split('/v1/', 1)[1]))
            reply = answers.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return Answer(json.dumps(reply).encode())
        result = Tracker('t', 'db', opener=opener, sleep=waits.append)._request(method, path, body)
        return result, sent, waits

    def test_reads_queries_and_property_updates_are_sent_again(self):
        for method, path in (('GET', 'pages/p'), ('POST', 'databases/db1/query'), ('POST', 'search'), ('PATCH', 'pages/p')):
            with self.subTest(method=method, path=path):
                result, sent, waits = self.run_with(method, path, {}, [http_error(520), {'ok': True}])
                self.assertEqual((result, len(sent), waits), ({'ok': True}, 2, [0.5]))

    def test_appended_blocks_fail_at_once(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.run_with('PATCH', 'blocks/p/children', {'children': []}, [http_error(522), {'ok': True}])

    def test_a_new_page_notion_made_anyway_is_returned_not_made_twice(self):
        made = {'id': 'page-1', 'object': 'page'}
        result, sent, _ = self.run_with('POST', 'pages', JOB, [http_error(520), {'results': [made], 'has_more': False}])
        self.assertEqual(result, made)
        self.assertEqual(sent, [('POST', 'pages'), ('POST', 'databases/db1/query')])   # one create, then the lookup: no second create

    def test_a_new_page_notion_did_not_make_is_made_once(self):
        result, sent, _ = self.run_with('POST', 'pages', JOB, [http_error(524), {'results': [], 'has_more': False}, {'id': 'page-2'}])
        self.assertEqual(result, {'id': 'page-2'})
        self.assertEqual(sent, [('POST', 'pages'), ('POST', 'databases/db1/query'), ('POST', 'pages')])

    def test_a_new_page_with_no_job_url_is_not_sent_again(self):
        body = {'parent': {'database_id': 'db1'}, 'properties': {'Name': {'title': []}}}
        with self.assertRaises(urllib.error.HTTPError):
            self.run_with('POST', 'pages', body, [http_error(520), {'id': 'twice'}])


if __name__ == '__main__':
    unittest.main()
