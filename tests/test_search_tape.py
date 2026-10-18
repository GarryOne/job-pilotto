"""The search tape (src/search_tape.py): a search's web and AI answers recorded once, replayed offline with nothing leaving the computer."""
import email.message
import io
import os
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import search_tape  # noqa: E402
from src.ai.providers import contract  # noqa: E402


class FakeReply(io.BytesIO):
    status = 200
    headers = email.message.Message()

    def __init__(self, body, url):
        super().__init__(body)
        self.url = url

    def geturl(self):
        return self.url


class TapeTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.env = {'JOB_PILOTTO_SEARCH_TAPE': folder.name, 'JOB_PILOTTO_TAPE_WAIT_SCALE': '0'}
        search_tape._index.clear()
        self.addCleanup(search_tape._index.clear)
        for key in search_tape.counts:
            search_tape.counts[key] = 0

    def mode(self, mode):
        search_tape._index.clear()   # a new process reads the tape again
        return mock.patch.dict(os.environ, {**self.env, 'JOB_PILOTTO_SEARCH_TAPE_MODE': mode})


class WaitScaleTest(TapeTest):
    def slept(self, scale, seconds=10):
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_TAPE_WAIT_SCALE': scale}), mock.patch.object(search_tape.time, 'sleep') as sleep:
            search_tape._wait(seconds)
        return [call.args[0] for call in sleep.call_args_list]

    def test_the_scale_multiplies_the_recorded_wait(self):
        """1 = as recorded, 0.1 = ten times faster, 0 = no wait (18 Oct 2026: --speed 20 slept 20x the recorded time, hours)."""
        self.assertEqual(self.slept('1'), [10])
        self.assertEqual(self.slept('0.1'), [1.0])
        self.assertEqual(self.slept('0'), [])

    def test_the_old_speed_flag_is_refused(self):
        run = (Path(__file__).resolve().parents[1] / 'tools' / 'persona-search' / 'run.mjs').read_text()
        self.assertIn("includes('--speed')", run)
        self.assertNotIn('TAPE_SPEED', run)


class WebTest(TapeTest):
    def test_a_recorded_page_is_replayed_without_the_web(self):
        sites = {'https://jobs.test/a': b'<html>job a</html>'}
        calls = []

        def real(request, data=None, *args, **kwargs):
            url = request.full_url if isinstance(request, urllib.request.Request) else request
            calls.append(url)
            if url not in sites:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return FakeReply(sites[url], url)
        urlopen = search_tape._web(real)
        with self.mode('record'):
            self.assertEqual(urlopen('https://jobs.test/a', timeout=5).read(), b'<html>job a</html>')
            with self.assertRaises(urllib.error.HTTPError):
                urlopen(urllib.request.Request('https://jobs.test/gone'))
        self.assertEqual(len(calls), 2)
        with self.mode('replay'):
            with urlopen('https://jobs.test/a') as reply:
                self.assertEqual((reply.read(), reply.status, reply.geturl()), (b'<html>job a</html>', 200, 'https://jobs.test/a'))
            with self.assertRaises(urllib.error.HTTPError) as gone:
                urlopen('https://jobs.test/gone')
            self.assertEqual(gone.exception.code, 404)
            with self.assertRaisesRegex(urllib.error.URLError, 'not on the search tape'):
                urlopen('https://jobs.test/never-seen')
        self.assertEqual(len(calls), 2, 'replay never reaches the web')
        self.assertEqual((search_tape.counts['web_tape'], search_tape.counts['web_missing']), (2, 1))

    def test_a_replayed_page_reads_like_a_real_one_for_every_reader(self):
        """18 Oct 2026: headers were a dict, so careers.get_text raised on get_content_charset and no job board was read in any recorded search."""
        from src.sources import careers
        real = lambda request, data=None, *a, **k: FakeReply('Caf\u00e9 Stelle'.encode('latin-1'), 'https://jobs.test/b')
        reply_type = {'Content-Type': 'text/html; charset=latin-1'}
        def typed(request, data=None, *a, **k):
            reply = real(request)
            reply.headers['Content-Type'] = reply_type['Content-Type']
            return reply
        urlopen = search_tape._web(typed)
        for mode in ('record', 'replay'):
            with self.mode(mode), mock.patch.object(urllib.request, 'urlopen', urlopen), mock.patch.object(careers, '_public', return_value=True):
                self.assertEqual(careers.get_text('https://jobs.test/b'), 'Caf\u00e9 Stelle', mode)

    def test_the_apps_page_browser_on_another_port_is_the_same_request(self):
        real = lambda request, data=None, *a, **k: FakeReply(b'{"html": "<p>x</p>"}', request.full_url)
        urlopen = search_tape._web(real)
        ask = lambda port: urllib.request.Request(f'http://127.0.0.1:{port}/render', data=b'{"url": "https://jobs.test/a"}')
        with self.mode('record'):
            urlopen(ask(51234))
        with self.mode('replay'):
            self.assertEqual(urlopen(ask(60001)).read(), b'{"html": "<p>x</p>"}')


class AiTest(TapeTest):
    def client(self, answers):
        def build():
            def create(**params):
                answers.append(params)
                return contract.Response(content=[contract.TextBlock(f'answer {len(answers)}')], usage=contract.Usage(10, 2), model='m')
            return mock.Mock(messages=mock.Mock(create=create))
        return search_tape._Client(build)

    def test_an_answer_is_replayed_and_a_new_question_goes_live_and_is_kept(self):
        asked = []
        question = {'model': 'm', 'max_tokens': 5, 'messages': [{'role': 'user', 'content': 'score job 1, today is 2026-10-18'}]}
        with self.mode('record'):
            self.assertEqual(self.client(asked).messages.create(**question).content[0].text, 'answer 1')
        with self.mode('replay'):
            later_day = {**question, 'messages': [{'role': 'user', 'content': 'score job 1, today is 2026-11-02'}]}
            answer = self.client(asked).messages.create(**later_day)
            self.assertEqual((answer.content[0].text, answer.usage.input_tokens, len(asked)), ('answer 1', 10, 1))
            other = {**question, 'messages': [{'role': 'user', 'content': 'score job 2'}]}
            self.assertEqual(self.client(asked).messages.create(**other).content[0].text, 'answer 2')
        self.assertEqual((search_tape.counts['ai_tape'], search_tape.counts['ai_live']), (1, 1))
        with self.mode('replay'):
            self.assertEqual(self.client(asked).messages.create(**other).content[0].text, 'answer 2')
        self.assertEqual(len(asked), 2, 'the live answer was kept on the tape')


class InstallTest(unittest.TestCase):
    def test_a_normal_run_never_loads_the_tape(self):
        self.assertFalse(getattr(urllib.request.urlopen, 'search_tape', False))
        init = (Path(__file__).resolve().parents[1] / 'src' / '__init__.py').read_text()
        self.assertIn("if _os.getenv('JOB_PILOTTO_SEARCH_TAPE'):", init)


if __name__ == '__main__':
    unittest.main()
