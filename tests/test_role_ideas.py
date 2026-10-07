"""Roles suggested from the Profile (owner, 7 Oct 2026): asked of Claude at most once a day, counted in the places' titles, set-aside roles never back."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import role_ideas

SEARCH = {'role_keywords': ['vendeur', 'photographe'], 'locations': {'top_tier': ['gen[eè]ve']}}
ANSWER = {'ideas': [{'role': 'Cashier', 'word': 'caissier', 'why': 'shop'}, {'role': 'Seller', 'word': 'vendeur', 'why': 'already searched'},
                    {'role': 'Retoucher', 'word': 'retouche', 'why': 'Photoshop'}]}


class Client:
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(json.loads(kwargs['messages'][0]['content'].split('\n', 1)[1]))
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(ANSWER))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class RoleIdeasTest(unittest.TestCase):
    def setUp(self):
        self.store = mock.patch.object(role_ideas, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'r.json')
        self.store.start()

    def tearDown(self):
        self.store.stop()

    def test_ideas_are_counted_once_a_day_and_never_a_searched_or_set_aside_role(self):
        client = Client()
        titles = ['caissier 50%', 'caissière auxiliaire', 'retouche photo e-commerce', 'vendeur fnac']
        got = role_ideas.ideas('Photographer and shop seller', SEARCH, titles, client=client, today='2026-10-07')
        self.assertEqual([(i['word'], i['count']) for i in got], [('caissier', 1), ('retouche', 1)], 'a searched word is never proposed; sorted by count')
        again = role_ideas.ideas('Photographer and shop seller', SEARCH, titles, set_aside=['retouche'], client=client, today='2026-10-07')
        self.assertEqual([i['word'] for i in again], ['caissier'], 'set aside: not shown')
        self.assertEqual(len(client.calls), 1, 'asked once a day')
        role_ideas.ideas('x', SEARCH, titles, set_aside=['retouche'], client=client, today='2026-10-08')
        self.assertEqual(client.calls[1]['set_aside'], ['retouche'], 'the set-aside roles are told to Claude the next day')
        self.assertNotIn('cv', ' '.join(client.calls[0]).lower().replace('profile', ''), 'only the named fields are sent')

    def test_adding_a_suggested_role_keeps_todays_ideas_without_asking_again(self):
        client = Client()
        titles = ['caissier 50%', 'retouche photo']
        role_ideas.ideas('Photographer and shop seller', SEARCH, titles, client=client, today='2026-10-07')
        grown = {**SEARCH, 'role_keywords': SEARCH['role_keywords'] + ['caissier']}
        got = role_ideas.ideas('Photographer and shop seller', grown, titles, client=client, today='2026-10-07')
        self.assertEqual([i['word'] for i in got], ['retouche'], 'the added role leaves the list; the others stay')
        self.assertEqual(len(client.calls), 1, 'no second call for a role added from the list')
        other = {**SEARCH, 'role_keywords': ['comptable']}
        role_ideas.ideas('Accountant', other, titles, client=client, today='2026-10-07')
        self.assertEqual(len(client.calls), 2, 'a different search (roles removed or replaced) is asked anew')

    def test_no_profile_no_call(self):
        self.assertEqual(role_ideas.ideas('', SEARCH, [], client=Client(), today='2026-10-09'), [])


if __name__ == '__main__':
    unittest.main()
