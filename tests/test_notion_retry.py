"""The Notion client waits and retries on 429 (busy) and 502/503/504 (briefly down), then gives up, when sending again can't make a
second copy (src/notion/retry.py: statuses × kinds of request; a new page after looking it up by its Job URL)."""
import io
import json
import unittest
import urllib.error

from src.notion import retry
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
# One request of each kind (src/notion/retry.py kind()).
SAMPLES = {'safe': [('GET', 'pages/p', None), ('POST', 'databases/db1/query', {}), ('POST', 'search', {}), ('PATCH', 'pages/p', {}),
                    ('DELETE', 'blocks/b', None)],
           'create': [('POST', 'pages', JOB)],
           'append': [('PATCH', 'blocks/p/children', {'children': []})],
           'other': [('POST', 'comments', {})]}


class RetryTableTest(unittest.TestCase):
    """Every status × kind of request does what the table says (9 Oct 2026: a 520 stopped a Move to Notion; 502-504 were retried for every
    request, so a page Notion made before losing the answer was made twice)."""
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

    def test_the_table_covers_every_kind_and_the_samples_are_those_kinds(self):
        for family in retry.TABLE.values():
            self.assertEqual(set(family), set(SAMPLES))
        for name, requests in SAMPLES.items():
            for method, path, _ in requests:
                self.assertEqual(retry.kind(method, path), name, (method, path))

    def test_every_cell(self):
        for status in sorted(retry.BUSY | retry.DOWN | retry.EDGE):
            for name, requests in SAMPLES.items():
                for method, path, body in requests:
                    wanted = retry.action(status, method, path)
                    with self.subTest(status=status, kind=name, method=method, path=path, wanted=wanted):
                        lookup = [{'results': [], 'has_more': False}] if wanted in (retry.LOOKUP, retry.LOOKUP_OR_RETRY) else []
                        answers = [http_error(status)] + lookup + [{'ok': True}]
                        if wanted == retry.FAIL:
                            with self.assertRaises(urllib.error.HTTPError):
                                self.run_with(method, path, body, answers)
                            continue
                        result, sent, _ = self.run_with(method, path, body, answers)
                        self.assertEqual(result, {'ok': True})
                        self.assertEqual(sent[0], sent[-1])   # the same request, sent again
                        self.assertEqual(len(sent), 3 if lookup else 2)

    def test_busy_and_down_retry_as_always_and_the_edge_never_doubles_a_write(self):
        everything = [(m, p) for reqs in SAMPLES.values() for m, p, _ in reqs]
        self.assertEqual({retry.action(429, m, p) for m, p in everything}, {retry.RETRY})
        for status in retry.DOWN:   # D7: as before, every request is sent again; a new page with a Job URL is looked up first
            self.assertNotIn(retry.FAIL, {retry.action(status, m, p) for m, p in everything})
            self.assertEqual(retry.action(status, 'POST', 'pages'), retry.LOOKUP_OR_RETRY)
        for status in retry.EDGE:
            self.assertEqual(retry.action(status, 'PATCH', 'blocks/p/children'), retry.FAIL)
            self.assertEqual(retry.action(status, 'POST', 'pages'), retry.LOOKUP)
        self.assertEqual(retry.action(404, 'GET', 'pages/p'), retry.FAIL)

    def test_a_new_page_notion_made_anyway_is_returned_not_made_twice(self):
        made = {'id': 'page-1', 'object': 'page'}
        for status in (502, 520):
            with self.subTest(status=status):
                result, sent, _ = self.run_with('POST', 'pages', JOB, [http_error(status), {'results': [made], 'has_more': False}])
                self.assertEqual(result, made)
                self.assertEqual(sent, [('POST', 'pages'), ('POST', 'databases/db1/query')])   # no second create

    def test_a_new_page_notion_did_not_make_is_made_once(self):
        result, sent, _ = self.run_with('POST', 'pages', JOB, [http_error(504), {'results': [], 'has_more': False}, {'id': 'page-2'}])
        self.assertEqual(result, {'id': 'page-2'})
        self.assertEqual(sent, [('POST', 'pages'), ('POST', 'databases/db1/query'), ('POST', 'pages')])

    def test_a_new_page_with_no_job_url_is_sent_again_when_notion_was_down_never_after_an_edge_error(self):
        body = {'parent': {'database_id': 'db1'}, 'properties': {'Name': {'title': []}}}
        result, sent, _ = self.run_with('POST', 'pages', body, [http_error(502), {'id': 'p'}])   # as before 9 Oct 2026: no lookup, no key
        self.assertEqual((result, sent), ({'id': 'p'}, [('POST', 'pages'), ('POST', 'pages')]))
        with self.assertRaises(urllib.error.HTTPError):
            self.run_with('POST', 'pages', body, [http_error(520), {'id': 'twice'}])

if __name__ == '__main__':
    unittest.main()
