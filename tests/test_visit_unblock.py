"""Get unstuck (7 Oct 2026): Claude picks at most two steps toward a page's job list among its listed ways on, or says it needs the person."""
import json
import unittest
from types import SimpleNamespace

from src.ai import visit_unblock

WAYS = [{'id': 'w1', 'kind': 'button', 'label': 'See all jobs'}, {'id': 'w2', 'kind': 'link', 'label': 'Careers', 'href': 'https://careers.maison.example/jobs'},
        {'id': 'w3', 'kind': 'link', 'label': 'Watches', 'href': 'http://maison.example/watches'}, {'id': 'w4', 'kind': 'select', 'label': 'Country', 'options': ['Switzerland', 'France']}]


class Client:
    def __init__(self, answer):
        self.answer, self.asked = answer, None
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.asked = kwargs
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answer))], usage=SimpleNamespace(input_tokens=10, output_tokens=5))


class UnblockTest(unittest.TestCase):
    def test_only_listed_ways_and_safe_actions_are_kept(self):
        client = Client({'why': 'open the job list', 'needs_person': '', 'steps': [
            {'control': 'w2', 'action': 'open', 'value': ''}, {'control': 'w9', 'action': 'click', 'value': ''},
            {'control': 'w3', 'action': 'open', 'value': ''}, {'control': 'w4', 'action': 'select', 'value': 'Mars'}]})
        planned = visit_unblock.plan({'url': 'https://maison.example', 'title': 'Maison', 'text': 'Welcome', 'ways': WAYS}, {'role_keywords': ['vendeur']}, client=client)
        self.assertEqual([(s['control'], s['action'], s['href']) for s in planned['steps']], [('w2', 'open', 'https://careers.maison.example/jobs')],
                         'an unknown id, a plain-http link and an option the select lacks are dropped')
        sent = json.loads(client.asked['messages'][0]['content'].split('\n', 1)[1])
        self.assertNotIn('role_words', sent['search'], 'no role word to type: the place only (7 Oct 2026)')
        self.assertNotIn('cv', json.dumps(sent).lower(), 'never the CV')

    def test_a_page_that_needs_the_person_is_said(self):
        client = Client({'why': 'a sign-in wall', 'needs_person': 'sign in to see jobs', 'steps': []})
        planned = visit_unblock.plan({'url': 'https://x.example', 'ways': WAYS}, {}, client=client)
        self.assertEqual((planned['steps'], planned['needs_person']), ([], 'sign in to see jobs'))

    def test_no_ways_asks_nothing(self):
        self.assertEqual(visit_unblock.plan({'url': 'https://x.example', 'ways': []}, {}, client=Client({}))['steps'], [])


if __name__ == '__main__':
    unittest.main()


class SecondTryTest(unittest.TestCase):
    def test_sonnet_looks_for_a_way_once_only_when_haiku_found_none_and_the_page_needs_no_one(self):
        nothing = Client({'why': '', 'needs_person': '', 'steps': []})
        way = Client({'why': 'open the list', 'needs_person': '', 'steps': [{'control': 'w2', 'action': 'open', 'value': ''}]})
        planned = visit_unblock.plan_twice({'url': 'https://maison.example', 'ways': WAYS}, {}, client=nothing, second_client=way)
        self.assertEqual((planned['model'], planned['steps'][0]['control']), (visit_unblock.SECOND_MODEL, 'w2'))
        self.assertEqual(way.asked['model'], visit_unblock.SECOND_MODEL)
        wall = Client({'why': '', 'needs_person': 'sign in', 'steps': []})
        untouched = Client({})
        self.assertEqual(visit_unblock.plan_twice({'url': 'https://x.example', 'ways': WAYS}, {}, client=wall, second_client=untouched)['needs_person'], 'sign in')
        self.assertIsNone(untouched.asked, 'a page that needs the person is not asked again')
