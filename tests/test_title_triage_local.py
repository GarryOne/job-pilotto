"""Titles of jobs located in the user's own places are sorted first and past the clock (24 Oct 2026, Chisinau: worldwide-remote titles spent the 3 minutes)."""
import json
import pathlib
import re
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.ai import title_triage
from src.sources import feeds

SEARCH = {'role_keywords': ['software engineer'], 'title_exclude_keywords': []}


class Client:
    def __init__(self):
        self.asked = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
        self.asked += [line.split('. ', 1)[1] for line in listed]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': [1]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class LocalFirstTest(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json'),
                        mock.patch.object(feeds, 'PLACE', re.compile(r'moldova|chi[sș]in[aă]u', re.I))]
        for patch in self.patches:
            patch.start()
        time_budget.start(180, now=time.monotonic() - 1000)   # the clock ran out long ago
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))

    def tearDown(self):
        for patch in self.patches:
            patch.stop()

    def test_local_titles_are_sorted_after_the_clock_and_others_wait(self):
        client = Client()
        title_triage.decide(['Java Developer', 'Data Engineer'], SEARCH, client, local=True)
        title_triage.decide(['Remote Rust Engineer'], SEARCH, client)
        self.assertEqual(client.asked, ['java developer', 'data engineer'], 'the local titles were asked, the remote one waits for the next refresh')

    def test_the_floor_is_the_searchs_first_titles_only(self):
        client = Client()
        titles = [f'Engineer {n}' for n in range(time_budget.LOCAL_TITLES + 30)]
        title_triage.decide(titles, SEARCH, client, local=True)
        self.assertEqual(len(client.asked), time_budget.LOCAL_TITLES)

    def test_a_job_is_in_my_place_by_its_location_not_by_being_remote(self):
        for location, mine in [('Chișinău', True), ('Moldova', True), ('MD', True), ('Remote - Worldwide', False), ('Remote', False), ('Berlin', False)]:
            with self.subTest(location=location), mock.patch.object(feeds, 'place_of', return_value=None):
                self.assertEqual(feeds.in_my_place({'title': 'x', 'location': location}), mine)


if __name__ == '__main__':
    unittest.main()
