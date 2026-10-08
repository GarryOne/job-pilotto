"""The AI page reader (src/ai/page_reader.py) and the headless renderer's guard rails (src/sources/render.py), with a fake model and no browser."""
import json
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import page_reader  # noqa: E402
from src.sources import careers, render  # noqa: E402

PAGE = ('<html><body><h1>Karriere</h1><p>Wir suchen einen Site Reliability Engineer in Zürich.</p>'
        '<a href="/jobs/sre-zh">Site Reliability Engineer (100%)</a><a href="/about">Über uns</a><a href="https://evil.example/x">Partner</a></body></html>')
ANSWER = {'jobs': [{'name': 'Site Reliability Engineer (100%)', 'place': 'Zürich', 'link': '/jobs/sre-zh'},
                   {'name': 'Fake', 'place': '', 'link': 'https://evil.example/x'},
                   {'name': 'x', 'place': '', 'link': ''}, {'name': '<script>', 'place': '', 'link': ''},
                   {'name': 'Site Reliability Engineer (100%)', 'place': 'Zürich', 'link': '/jobs/sre-zh'}]}


class FakeClient:
    def __init__(self, answer=ANSWER, stop='end_turn'):
        self.calls, self.answer, self.stop = [], answer, stop
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason=self.stop, content=[SimpleNamespace(type='text', text=json.dumps(self.answer))], usage=None)


class ReaderTests(unittest.TestCase):
    def setUp(self):
        page_reader._reads['n'] = 0
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE page_reads (url TEXT PRIMARY KEY, digest TEXT NOT NULL, jobs_json TEXT NOT NULL, read_at TEXT NOT NULL)')
        patch = mock.patch.object(page_reader, 'wanted_text', lambda: page_reader.careers.ats.re.compile(r'site reliability|\bsre\b', 2))
        patch.start()
        self.addCleanup(patch.stop)

    def test_the_answer_becomes_jobs_with_links_kept_on_the_employers_own_site(self):
        jobs = page_reader.read('https://acme.ch/karriere', PAGE, FakeClient(), self.db)
        self.assertEqual([(j['title'], j['location'], j['url']) for j in jobs],
                         [('Site Reliability Engineer (100%)', 'Zürich', 'https://acme.ch/jobs/sre-zh'), ('Fake', '', 'https://acme.ch/karriere')])   # evil.example link replaced by the page; junk and duplicates dropped

    def test_an_unchanged_page_is_not_read_again_and_a_changed_one_is(self):
        client = FakeClient()
        page_reader.read('https://acme.ch/k', PAGE, client, self.db)
        page_reader.read('https://acme.ch/k', PAGE, client, self.db)
        self.assertEqual(len(client.calls), 1)
        page_reader.read('https://acme.ch/k', PAGE + '<p>New: DevOps SRE</p>', client, self.db)
        self.assertEqual(len(client.calls), 2)

    def test_a_page_that_names_none_of_your_roles_costs_nothing(self):
        client = FakeClient()
        self.assertIsNone(page_reader.read('https://acme.ch/k', '<p>Wir suchen Köche</p>', client, self.db))
        self.assertEqual(client.calls, [])

    def test_the_page_is_sent_as_untrusted_text_in_a_fixed_shape_to_a_small_model(self):
        client = FakeClient()
        page_reader.read('https://acme.ch/k', PAGE, client, self.db)
        call = client.calls[0]
        self.assertEqual(call['model'], 'claude-haiku-5-5')
        self.assertIn('untrusted', call['system'][0]['text'])
        self.assertIn('Site Reliability Engineer (100%) -> https://acme.ch/jobs/sre-zh', call['messages'][0]['content'])
        self.assertEqual(call['output_config']['format']['schema']['required'], ['jobs'])

    def test_a_process_stops_asking_after_its_limit_but_keeps_earlier_answers(self):
        client = FakeClient()
        page_reader.read('https://acme.ch/k', PAGE, client, self.db)
        page_reader._reads['n'] = page_reader.MAX_READS_PER_RUN
        self.assertIsNone(page_reader.read('https://other.ch/k', PAGE, client, self.db))
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(len(page_reader.read('https://acme.ch/k', PAGE, client, self.db)), 2)   # cached

    def test_a_cut_off_answer_raises_and_nothing_is_cached(self):
        with self.assertRaises(RuntimeError):
            page_reader.read('https://acme.ch/k', PAGE, FakeClient(stop='max_tokens'), self.db)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM page_reads').fetchone()[0], 0)


class RenderGuardTests(unittest.TestCase):
    def test_it_says_no_without_playwright_and_never_reaches_private_addresses(self):
        with mock.patch.dict(sys.modules, {'playwright': None, 'playwright.sync_api': None}):
            self.assertFalse(render.available())
        for bad in ('http://127.0.0.1/', 'file:///etc/passwd', 'http://localhost:8080'):
            with self.assertRaises(ValueError):
                render.render(bad)

    def test_robots_txt_is_not_consulted(self):
        """Owner's decision, 6 Oct 2026: a site that does not want us blocks us (a 401/403/429 or a bot check is still a refusal)."""
        self.assertFalse(hasattr(render, '_allowed'))
        self.assertNotIn('robots', render._state)

    def test_the_scout_uses_the_browser_only_when_it_is_there(self):
        saved = careers.RENDER
        try:
            careers.RENDER = 'auto'
            with mock.patch.object(render, 'available', return_value=False):
                self.assertIsNone(careers.renderer())
            with mock.patch.object(render, 'available', return_value=True):
                self.assertIs(careers.renderer(), render.render)
            with mock.patch.dict('os.environ', {'JOB_PILOTTO_RENDER': '0'}):
                self.assertIsNone(careers.renderer())
        finally:
            careers.RENDER = saved


if __name__ == '__main__':
    unittest.main()
