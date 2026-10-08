"""Job boards proposed by Claude (src/ai/board_ideas.py): only a checked shape is ever read, one call per countries/roles/kinds, nothing
without AI. Spec: docs/superpowers/specs/2026-10-08-job-board-discovery.md."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import board_ideas  # noqa: E402

LISBON = {'role_keywords': ['developer'], 'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
ANSWER = {'boards': [
    {'name': 'Net-Empregos', 'search_url': 'https://www.net-empregos.com/pesquisa-empregos.asp?chaves={role}&zona={place}', 'countries': ['Portugal'], 'kinds': ['any']},
    {'name': 'ITJobs', 'search_url': 'https://www.itjobs.pt/emprego?q={role}', 'countries': ['Portugal'], 'kinds': ['software']},
    {'name': 'Indeed', 'search_url': 'https://pt.indeed.com/jobs?q={role}&l={place}', 'countries': ['Portugal'], 'kinds': ['any']},
    {'name': 'Plain http', 'search_url': 'http://jobs.example/?q={role}', 'countries': [], 'kinds': []},
    {'name': 'No role', 'search_url': 'https://jobs.example/all', 'countries': [], 'kinds': []},
    {'name': 'Odd field', 'search_url': 'https://jobs.example/?q={role}&k={token}', 'countries': [], 'kinds': []},
    {'name': 'jobs.ch again', 'search_url': 'https://www.jobs.ch/en/vacancies/?term={role}', 'countries': ['Switzerland'], 'kinds': ['any']}]}


class FakeClient:
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps(ANSWER))])


class BoardIdeasTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)),
                      mock.patch('src.places.load', return_value={'lisboa': {'kind': 'city', 'countries': ['Portugal']}})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_only_checked_boards_are_kept_and_asked_once(self):
        client = FakeClient()
        found = board_ideas.ideas(LISBON, client)
        self.assertEqual([b['host'] for b in found], ['net-empregos.com', 'itjobs.pt'])   # a portal, http, no {role}, odd fields, an own reader: out
        self.assertEqual(found[1]['kinds'], ['software'])
        self.assertEqual(board_ideas.ideas(LISBON, client), found)
        self.assertEqual(len(client.calls), 1)
        sent = json.loads(client.calls[0]['messages'][0]['content'])
        self.assertEqual(sent['countries'], ['Portugal'])
        self.assertNotIn('cv', json.dumps(sent).lower())

    def test_without_ai_or_countries_nothing_is_proposed(self):
        with mock.patch('src.ai.engine.ready', return_value=False):
            self.assertEqual(board_ideas.ideas(LISBON), [])
        with mock.patch('src.places.load', return_value={}):
            self.assertEqual(board_ideas.ideas({'role_keywords': ['x'], 'locations': {'top_tier': ['Nowhere']}}, FakeClient()), [])


if __name__ == '__main__':
    unittest.main()
