"""A remote job limited to a region the user excluded ("USA - Remote") is outside the places of a user who picked only towns (owner, 21 Oct 2026,
Chișinău): it is never "vague" (kept until its posting is read), also when the AI is limited and with answers stored before this fix."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import place_triage
from src.sources import feeds

SEARCH = {'locations': {'top_tier': ['chi[sș]in[aă]u'], 'country_wide': ['moldova'], 'abroad': []}, 'remote_jobs': ['Yes'],
          'remote_excluded_regions': [r'\busa?\b', 'united states', 'north america', 'emea']}
SHAPES = ['USA - Remote', 'United States · Remote', 'Remote - US', 'Remote, EMEA']


class EagerClient:
    """A weak answer: every location outside is "vague" (what the model said for the shot's shapes)."""
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        content = kwargs['messages'][0]['content']
        self.calls.append(content)
        listed = content.split('The job locations:\n', 1)[1].split('\n')
        answer = {'vague': [int(line.split('.', 1)[0]) for line in listed]}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class RemoteExcludedRegionTests(unittest.TestCase):
    def setUp(self):
        folder = pathlib.Path(tempfile.mkdtemp())
        self.patches = [mock.patch.object(place_triage, 'STORE', folder / 'p.json'), mock.patch.object(place_triage, 'READ_STORE', folder / 'r.json'),
                        mock.patch.object(feeds, '_SEARCH', SEARCH), mock.patch.object(feeds, 'REMOTE_ELSEWHERE', feeds.place_regex(SEARCH['remote_excluded_regions']))]
        for patch in self.patches:
            patch.start()
        feeds.PLACED, feeds.READ = None, {}

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        feeds.PLACED = feeds.READ = None

    def job(self, location):
        return {'url': f'https://x.test/{location}', 'title': 'Engineer', 'location': location, 'description': 'A remote role.'}

    def test_a_weak_vague_answer_never_keeps_an_excluded_remote_region(self):
        norms = [place_triage.norm(s) for s in SHAPES]
        place_triage._keep(place_triage._key(SEARCH), {n: 'out' for n in norms})
        decided = place_triage.vague(SHAPES, SEARCH, EagerClient())
        for shape, n in zip(SHAPES, norms):
            with self.subTest(shape):
                self.assertEqual(decided[n], 'out:clear')

    def test_answers_stored_as_vague_are_repaired_without_asking(self):
        feeds.PLACED = {place_triage.norm(s): 'out:vague' for s in SHAPES + ['Remote', 'Switzerland']}
        for shape in SHAPES:
            with self.subTest(shape):
                self.assertEqual(feeds.place_of(self.job(shape)), 'out')
                self.assertFalse(feeds.wanted_location(self.job(shape)))
        for shape in ('Remote', 'Switzerland'):
            with self.subTest(shape):
                self.assertEqual(feeds.place_of(self.job(shape)), 'vague', 'a place-less or unexcluded location stays open for its posting')

    def test_the_vague_question_gets_the_places(self):
        client = EagerClient()
        place_triage._keep(place_triage._key(SEARCH), {'switzerland': 'out'})
        place_triage.vague(['Switzerland'], SEARCH, client)
        self.assertIn('best_places', client.calls[0], 'vague = could contain one of their places')


if __name__ == '__main__':
    unittest.main()
